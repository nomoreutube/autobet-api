import type { NextApiRequest, NextApiResponse } from "next";
import PocketBase from "pocketbase";

type BalanceResponse = {
	balance?: number;
	error?: string;
};

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse<BalanceResponse>
) {
	res.setHeader("Content-Type", "application/json");
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type");

	if (req.method === "OPTIONS") {
		return res.status(200).end();
	}

	if (req.method !== "GET") {
		return res.status(405).json({ error: "Method not allowed" });
	}

	const { id } = req.query;

	if (!id || typeof id !== "string") {
		return res.status(400).json({ error: "User ID is required" });
	}

	try {
		// Initialize PocketBase
		const pb = new PocketBase("https://db.serpanal.com/");
		await pb
			.collection("_superusers")
			.authWithPassword(
				process.env.POCKETBASE_EMAIL!,
				process.env.POCKETBASE_PASSWORD!
			);

		// Get current user record from autobet collection
		const userRecord = await pb.collection("autobet").getOne(id);

		res.status(200).json({
			balance: userRecord.balance,
		});
	} catch (error) {
		console.error("Balance API error:", error);
		return res.status(404).json({ error: "User not found" });
	}
}