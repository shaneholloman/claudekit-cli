import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { ReleasesApi } from "@/domains/github/client/releases-api.js";
import { ReleaseCache } from "@/domains/versioning/release-cache.js";
import type { GitHubRelease, KitConfig } from "@/types";

// Regression coverage for #749 — `listReleasesWithCache` must NOT
// persist an empty result to the on-disk release cache. Doing so
// turned a single transient upstream failure (network blip, OAuth
// scope race during first run, or an upstream 502 returning `[]`)
// into a permanent "No Releases Available" panel, because the
// poisoned cache entry was served on every subsequent run until the
// user manually deleted it.

describe("ReleasesApi.listReleasesWithCache cache poisoning", () => {
	const kit: KitConfig = {
		name: "engineer",
		owner: "mrgoonie",
		repo: "engineer-kit",
		// Other fields aren't read by the cache path under test.
	} as unknown as KitConfig;

	let cacheGetSpy: ReturnType<typeof spyOn>;
	let cacheSetSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		cacheGetSpy = spyOn(ReleaseCache.prototype, "get").mockResolvedValue(null);
		cacheSetSpy = spyOn(ReleaseCache.prototype, "set").mockResolvedValue(undefined);
	});

	afterEach(() => {
		cacheGetSpy.mockRestore();
		cacheSetSpy.mockRestore();
	});

	it("does NOT cache an empty release list (issue #749)", async () => {
		// Octokit-shaped getClient stub whose underlying `listReleases` (the
		// private method on the class) returns []. We stub the public
		// listReleases on the instance to keep the test free of the real
		// octokit type surface.
		const api = new ReleasesApi(async () => ({}) as never);
		const listReleasesSpy = spyOn(api, "listReleases").mockResolvedValue(
			[] as unknown as GitHubRelease[],
		);

		const result = await api.listReleasesWithCache(kit, { limit: 5 });

		expect(result).toEqual([]);
		expect(listReleasesSpy).toHaveBeenCalledTimes(1);
		// The crucial assertion: when the API returned [] we must NOT
		// poison the cache by writing it back.
		expect(cacheSetSpy).not.toHaveBeenCalled();

		listReleasesSpy.mockRestore();
	});

	it("DOES cache a non-empty release list", async () => {
		const sample: GitHubRelease[] = [
			{
				tag_name: "v1.0.0",
				name: "v1.0.0",
				draft: false,
				prerelease: false,
				published_at: "2026-04-26T00:00:00Z",
				created_at: "2026-04-26T00:00:00Z",
				assets: [],
				body: "",
				html_url: "",
				id: 1,
				target_commitish: "main",
			} as unknown as GitHubRelease,
		];

		const api = new ReleasesApi(async () => ({}) as never);
		const listReleasesSpy = spyOn(api, "listReleases").mockResolvedValue(sample);

		await api.listReleasesWithCache(kit, { limit: 5 });

		expect(cacheSetSpy).toHaveBeenCalledTimes(1);
		const firstCall = cacheSetSpy.mock.calls[0];
		expect(firstCall).toBeDefined();
		const cachedValue = (firstCall as unknown[])[1];
		expect(cachedValue).toEqual(sample);

		listReleasesSpy.mockRestore();
	});
});
