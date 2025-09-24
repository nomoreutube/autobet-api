import type { NextApiRequest, NextApiResponse } from "next";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";
import { z } from "zod";
import PocketBaseSingleton from "../../lib/pocketbase";

type ChatResponse = {
	red?: number;
	black?: number;
	balance?: number;
	error?: string;
};

type ChatRequest = {
	image: string; // base64 string
	id: string; // user id
};

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse<ChatResponse>
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

	const { image, id }: ChatRequest = req.body;

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
				content:
					"Look at the image and identify the numbers on the red and black diamonds. Return a JSON object with the format {red: amount, black: amount} where amount is the number shown on each diamond. IMPORTANT: Only identify actual numbers (digits 0-9). Do NOT identify letters like 'S' as numbers - if you see an 'S' or any letter, use 0. The image may contain shadows or reflections of chips above or behind the diamonds showing letters like 'S' or other symbols - completely ignore these chip shadows and only focus on the clear, visible numbers directly on the diamond surfaces themselves. If the digits are unclear but you can tell the number is at least 10 or higher (like 10, 15, 20, etc.), provide your best estimate of the actual number. If there is no number or you cannot determine any digits, use 0.",
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
			model: openrouter("openai/gpt-4.1-mini"),
			messages,
			experimental_output: Output.object({
				schema: z.object({
					red: z.number(),
					black: z.number(),
				}),
			}),
		});

		console.log("AI response:", experimental_output);
		res.status(200).json({
			...experimental_output,
			balance: newBalance,
		});
	} catch (error) {
		console.error("Chat API error:", error);
		res.status(500).json({ error: "Failed to generate response" });
	}
}
