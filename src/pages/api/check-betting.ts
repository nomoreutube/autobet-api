import type { NextApiRequest, NextApiResponse } from "next";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";
import { z } from "zod";
import PocketBaseSingleton from "../../lib/pocketbase";

type BettingResponse = {
	canBet?: boolean;
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

		const openrouter = createOpenRouter({
			apiKey: process.env.OPENROUTER_API_KEY,
		});

		const messages = [
			{
				role: "system" as const,
				content: `You are analyzing a betting interface screenshot to determine if betting is currently available.

TASK: Examine the image carefully and return a JSON object with the format {canBet: boolean}.

SET canBet to TRUE if you observe EITHER of these scenarios:

SCENARIO 1 - Active Betting Window:
- A countdown timer is visible showing 14 seconds or MORE remaining
- AND you can see text indicating "start betting", "bet now", or similar betting call-to-action
- The interface appears ready for user interaction

SCENARIO 2 - Preparing Phase:
- Text shows "preparing", "getting ready", or similar preparation messages
- AND the timer shows 0 seconds or is not visible
- This indicates the next betting round is about to begin

SET canBet to FALSE for all other conditions including:
- Timer shows less than 12 seconds (insufficient time to place bets)
- No betting-related text is visible
- Interface appears disabled or in a waiting state
- Timer is counting down but no betting interface is shown
- Any error states or loading screens
- Show Stop Betting text

Focus on: countdown timers, betting buttons/text, preparation messages, and overall interface state.

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
					canBet: z.boolean(),
				}),
			}),
		});

		console.log("Betting check AI response:", experimental_output);
		res.status(200).json({
			...experimental_output,
			balance: newBalance,
		});
	} catch (error) {
		console.error("Betting check API error:", error);
		res.status(500).json({ error: "Failed to check betting status" });
	}
}
