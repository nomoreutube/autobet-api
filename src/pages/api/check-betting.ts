import type { NextApiRequest, NextApiResponse } from "next";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";
import { z } from "zod";
import PocketBaseSingleton from "../../lib/pocketbase";

type BettingResponse = {
	startBetting?: boolean;
	timer?: number;
	balance?: number;
	error?: string;
};

type BettingRequest = {
	image: string; // base64 string
	id: string; // user id
	screenshotTime?: number; // timestamp when screenshot was taken
};

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse<BettingResponse>
) {
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

	const { image, id, screenshotTime }: BettingRequest = req.body;

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
			"balance+": -2,
		});

		const newBalance = userRecord.balance;

		const openrouter = createOpenRouter({
			apiKey: process.env.OPENROUTER_API_KEY,
		});

		const currentTime = Date.now();
		const timeSinceScreenshot = screenshotTime
			? (currentTime - screenshotTime) / 1000
			: 0;

		const messages = [
			{
				role: "system" as const,
				content: `You are analyzing a betting interface screenshot to extract betting status and timer information.

TASK: Examine the image carefully and return a JSON object with the format {startBetting: boolean, timer: number}.

CRITICAL RULES:

1. BOTH conditions must be met for startBetting to be TRUE:
   - "Start Betting" text MUST be clearly visible in the interface
   - AND the timer MUST show between 0-15 seconds

2. Set startBetting to FALSE if ANY of these conditions:
   - "Start Betting" text is NOT visible
   - OR timer shows MORE than 15 seconds
   - OR timer is not present

3. When startBetting is FALSE:
   - Set timer to 0

FOCUS ON: Look for "Start Betting" text AND verify timer is 15 seconds or less. Return the exact timer value shown in the interface.

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

		// Adjust timer based on screenshot time
		let adjustedTimer = experimental_output.timer;
		let startBetting = experimental_output.startBetting;

		if (startBetting && screenshotTime) {
			adjustedTimer = experimental_output.timer - timeSinceScreenshot;
			// If adjusted timer is negative or below 4 seconds, the betting window has passed
			if (adjustedTimer < 4) {
				startBetting = false;
				adjustedTimer = 0;
			}
		}

		res.status(200).json({
			startBetting,
			timer: adjustedTimer,
			balance: newBalance,
		});
	} catch (error) {
		console.error("Betting check API error:", error);
		res.status(500).json({ error: "Failed to check betting status" });
	}
}
