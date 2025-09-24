import PocketBase from "pocketbase";

class PocketBaseSingleton {
	private static instance: PocketBase | null = null;
	private static isAuthenticated = false;

	static async getInstance(): Promise<PocketBase> {
		if (!this.instance) {
			this.instance = new PocketBase("https://db.serpanal.com/");
			// Disable auto cancellation to prevent AbortError
			this.instance.autoCancellation(false);
		}

		// Authenticate if not already authenticated or if token expired
		if (!this.isAuthenticated || !this.instance.authStore.isValid) {
			try {
				await this.instance
					.collection("_superusers")
					.authWithPassword(
						process.env.POCKETBASE_EMAIL!,
						process.env.POCKETBASE_PASSWORD!
					);
				this.isAuthenticated = true;
			} catch (error) {
				console.error("PocketBase authentication failed:", error);
				this.isAuthenticated = false;
				throw error;
			}
		}

		return this.instance;
	}

	// Method to check if user exists in autobet collection
	static async checkUserExists(id: string): Promise<boolean> {
		try {
			const pb = await this.getInstance();
			await pb.collection("autobet").getOne(id);
			return true;
		} catch (error) {
			return false;
		}
	}
}

export default PocketBaseSingleton;