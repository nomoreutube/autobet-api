import type { NextApiRequest, NextApiResponse } from "next";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";
import { z } from "zod";
import PocketBaseSingleton from "../../lib/pocketbase";

// Timer management for betting cycles
interface BettingTimer {
	startTime: number;
	phase: "betting" | "waiting";
	bettingDuration: number; // 15 seconds
	waitingDuration: number; // 27 seconds
}

// Global shared timer for all users
let globalTimer: BettingTimer | null = null;
let logInterval: NodeJS.Timeout | null = null;

const BETTING_DURATION = 15 * 1000; // 15 seconds in ms
const WAITING_DURATION = 27 * 1000; // 27 seconds in ms
const TOTAL_CYCLE = BETTING_DURATION + WAITING_DURATION; // 42 seconds
const TIMER_EXPIRY = 60 * 60 * 1000; // 1 hour in ms

// Helper functions for timer management
function getCurrentTimerState(): { startBetting: boolean; timer: number } | null {
	if (!globalTimer) return null;

	const now = Date.now();
	const elapsed = now - globalTimer.startTime;

	// If timer has expired (1 hour), remove timer for time accuracy
	if (elapsed >= TIMER_EXPIRY) {
		globalTimer = null;
		if (logInterval) {
			clearInterval(logInterval);
			logInterval = null;
			console.log("Global timer expired after 1 hour - logging stopped");
		}
		return null;
	}

	// Calculate position in current 42-second cycle
	const cyclePosition = elapsed % TOTAL_CYCLE;

	// During betting phase (0-15s in cycle) - show betting countdown
	if (cyclePosition < BETTING_DURATION) {
		return {
			startBetting: true,
			timer: Math.ceil((BETTING_DURATION - cyclePosition) / 1000),
		};
	}

	// During waiting phase (15s-42s in cycle)
	return {
		startBetting: false,
		timer: 0,
	};
}

function startBettingTimer(initialTimer: number, requestStartTime: number): void {
	// Account for the time already elapsed based on the timer value received
	// AND the processing time from request start to now
	// PLUS an additional 1-second buffer for timing discrepancies
	const processingTime = Date.now() - requestStartTime;
	const additionalBuffer = 1000; // 1 second buffer
	const elapsedTime = (15 - initialTimer) * 1000 + processingTime + additionalBuffer;
	const adjustedStartTime = Date.now() - elapsedTime;

	globalTimer = {
		startTime: adjustedStartTime,
		phase: "betting",
		bettingDuration: BETTING_DURATION,
		waitingDuration: WAITING_DURATION,
	};

	// Start logging timer state every second
	if (logInterval) {
		clearInterval(logInterval);
	}

	logInterval = setInterval(() => {
		const currentState = getCurrentTimerState();
		if (currentState) {
			const now = Date.now();
			const elapsed = now - globalTimer!.startTime;
			const cyclePosition = elapsed % TOTAL_CYCLE;
			const cycleNumber = Math.floor(elapsed / TOTAL_CYCLE) + 1;

			console.log(`Cycle ${cycleNumber} - Position: ${Math.floor(cyclePosition/1000)}s - startBetting: ${currentState.startBetting}, timer: ${currentState.timer}`);
		} else {
			console.log("Global timer no longer active - stopping logs");
			if (logInterval) {
				clearInterval(logInterval);
				logInterval = null;
			}
		}
	}, 1000);
}

type BettingResponse = {
	startBetting?: boolean;
	timer?: number;
	balance?: number;
	error?: string;
};

type BettingRequest = {
	image: string; // base64 string
	id: string; // user id
};

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse<BettingResponse>
) {
	const requestStartTime = Date.now(); // Capture when request started

	res.setHeader("Content-Type", "application/json");
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type");

	if (req.method === "OPTIONS") {
		return res.status(200).end();
	}

	if (req.method !== "POST") {
		return res.status(405).json({ error: "Method not allowed" });
	}

	const { image, id }: BettingRequest = req.body;

	if (!image) {
		return res.status(400).json({ error: "Image is required" });
	}

	if (!id) {
		return res.status(400).json({ error: "User ID is required" });
	}

	try {
		// Get PocketBase instance
		const pb = await PocketBaseSingleton.getInstance();

		// Check if user exists
		const userExists = await PocketBaseSingleton.checkUserExists(id);
		if (!userExists) {
			return res.status(404).json({ error: "User not found" });
		}

		// Get current user record to check balance
		const currentUser = await pb.collection("autobet").getOne(id);
		if (currentUser.balance <= 0) {
			return res.status(400).json({ error: "Insufficient balance" });
		}

		// Atomically decrement balance by 1
		const userRecord = await pb.collection("autobet").update(id, {
			"balance+": -1,
		});

		const newBalance = userRecord.balance;

		// Check if there's an active global timer first
		const existingTimer = getCurrentTimerState();
		if (existingTimer) {
			console.log(`Global timer active - startBetting: ${existingTimer.startBetting}, timer: ${existingTimer.timer}, user: ${id}`);
			// Return current timer state without AI call but still charge balance
			return res.status(200).json({
				...existingTimer,
				balance: newBalance,
			});
		}

		const openrouter = createOpenRouter({
			apiKey: process.env.OPENROUTER_API_KEY,
		});

		const messages = [
			{
				role: "system" as const,
				content: `You are analyzing a betting interface screenshot to extract betting status and timer information.

TASK: Examine the image carefully and return a JSON object with the format {startBetting: boolean, timer: number}.

SIMPLE RULES:

IF "Start Betting" text is visible anywhere in the interface:
- Set startBetting to TRUE
- Find and return the actual timer value (number of seconds shown)

IF "Start Betting" text is NOT visible:
- Set startBetting to FALSE
- Set timer to 0

FOCUS ON: Look for "Start Betting" text first, then extract the timer number if betting text exists.

Return only the JSON object with no additional text.`,
			},
			{
				role: "user" as const,
				content: [
					{
						type: "image" as const,
						image: image.startsWith("data:")
							? image
							: `data:image/jpeg;base64,${image}`,
					},
				],
			},
		];

		const { experimental_output } = await generateText({
			model: openrouter("openai/gpt-4.1"),
			messages,
			experimental_output: Output.object({
				schema: z.object({
					startBetting: z.boolean(),
					timer: z.number(),
				}),
			}),
		});

		console.log("Betting check AI response:", experimental_output);

		// If AI detected start betting, start the global timer
		if (experimental_output.startBetting && experimental_output.timer > 0) {
			const processingTime = Date.now() - requestStartTime;
			console.log(`Starting global timer with AI detected timer: ${experimental_output.timer}, processing time: ${processingTime}ms`);
			startBettingTimer(experimental_output.timer, requestStartTime);
		}

		res.status(200).json({
			...experimental_output,
			balance: newBalance,
		});
	} catch (error) {
		console.error("Betting check API error:", error);
		res.status(500).json({ error: "Failed to check betting status" });
	}
}
