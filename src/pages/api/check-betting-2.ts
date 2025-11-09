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

	console.log("[check-betting-2] API called", {
		userId: id,
		hasImage: !!image,
		imageLength: image?.length || 0,
		timestamp: new Date().toISOString(),
	});

	if (!image) {
		console.log("[check-betting-2] Error: Image missing");
		return res.status(400).json({ error: "Image is required" });
	}

	if (!id) {
		console.log("[check-betting-2] Error: User ID missing");
		return res.status(400).json({ error: "User ID is required" });
	}

	try {
		// Get PocketBase instance
		const pb = await PocketBaseSingleton.getInstance();

		// Check if user exists
		const userExists = await PocketBaseSingleton.checkUserExists(id);
		console.log("[check-betting-2] User exists check:", { userId: id, exists: userExists });

		if (!userExists) {
			console.log("[check-betting-2] Error: User not found");
			return res.status(404).json({ error: "User not found" });
		}

		// Get current user record to check balance
		const currentUser = await pb.collection("autobet").getOne(id);
		console.log("[check-betting-2] Current user balance:", { userId: id, balance: currentUser.balance });

		if (currentUser.balance <= 0) {
			console.log("[check-betting-2] Error: Insufficient balance", { balance: currentUser.balance });
			return res.status(400).json({ error: "Insufficient balance" });
		}

		// Atomically decrement balance by 2
		const userRecord = await pb.collection("autobet").update(id, {
			"balance+": -2,
		});

		const newBalance = userRecord.balance;
		console.log("[check-betting-2] Balance deducted:", { oldBalance: currentUser.balance, newBalance, deducted: 2 });

		const openrouter = createOpenRouter({
			apiKey: process.env.OPENROUTER_API_KEY,
		});

		const messages = [
			{
				role: "system" as const,
				content: `reply in this format, only set startBetting to true if the there is a very clear start betting text. { number: number, startBetting: boolean}`,
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

		console.log("[check-betting-2] Calling AI model...", { model: "qwen/qwen3-vl-8b-instruct" });

		const { experimental_output } = await generateText({
			model: openrouter("qwen/qwen3-vl-8b-instruct"),
			messages,
			experimental_output: Output.object({
				schema: z.object({
					startBetting: z.boolean(),
					timer: z.number(),
				}),
			}),
		});

		console.log("[check-betting-2] AI model response:", experimental_output);

		// Adjust timer based on screenshot time
		const timer = experimental_output.timer;
		const startBetting = experimental_output.startBetting;

		const response = {
			startBetting,
			timer: Number(timer.toFixed(1)),
			balance: newBalance,
		};

		console.log("[check-betting-2] Sending response:", response);

		return res.status(200).json(response);
	} catch (error) {
		console.error("[check-betting-2] Error:", error);
		console.error("[check-betting-2] Error stack:", error instanceof Error ? error.stack : "No stack trace");
		return res.status(500).json({ error: "Failed to check betting status" });
	}
}
