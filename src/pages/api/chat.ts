import type { NextApiRequest, NextApiResponse } from "next";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";

type ChatResponse = {
	message?: string;
	error?: string;
};

type ChatRequest = {
	image: string; // base64 string
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

	const { image }: ChatRequest = req.body;

	if (!image) {
		return res.status(400).json({ error: "Image is required" });
	}

	try {
		const openrouter = createOpenRouter({
			apiKey: process.env.OPENROUTER_API_KEY,
		});

		const messages: any[] = [
			{
				role: "system",
				content: "Look at the image and give me a JSON object in the format {red: boolean, black: boolean} where true means there is a number shown on the red diamond and black is for the black diamond.",
			},
			{
				role: "user",
				content: [
					{
						type: "image_url",
						image_url: {
							url: image.startsWith("data:") ? image : `data:image/jpeg;base64,${image}`,
						},
					},
				],
			},
		];

		const { text } = await generateText({
			model: openrouter("openai/gpt-4.1-nano"),
			messages,
		});

		try {
			const parsedResponse = JSON.parse(text);
			res.status(200).json(parsedResponse);
		} catch (parseError) {
			res.status(200).json({ message: text });
		}
	} catch (error) {
		console.error("Chat API error:", error);
		res.status(500).json({ error: "Failed to generate response" });
	}
}
