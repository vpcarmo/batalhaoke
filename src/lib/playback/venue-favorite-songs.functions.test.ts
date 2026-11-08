import { describe, expect, it } from "vitest";
import {
  favoriteRowsToResults,
  venueFavoriteSongInputSchema,
} from "./venue-favorite-songs.functions";

describe("venue favorite songs", () => {
  it("validates explicit venue and preserves an unreproduced song identity and metadata", () => {
    const song = {
      provider: "youtube",
      externalId: "external-123",
      title: "Canção",
      channelName: "Artista",
      thumbnailUrl: "https://example.com/image.jpg",
      duration: "3:15",
      metadata: { quality: "karaoke" },
    };
    expect(
      venueFavoriteSongInputSchema.parse({ venueId: "11111111-1111-4111-8111-111111111111", song }),
    ).toEqual({
      venueId: "11111111-1111-4111-8111-111111111111",
      song,
    });
    expect(() => venueFavoriteSongInputSchema.parse({ venueId: "not-a-uuid", song })).toThrow();
  });

  it("reconstructs the provider search result contract, including nullable metadata", () => {
    expect(
      favoriteRowsToResults([
        {
          source: {
            provider: "youtube",
            external_id: "external-123",
            title: "Canção",
            channel_name: null,
            thumbnail_url: null,
            duration: null,
            metadata: null,
          },
        },
      ]),
    ).toEqual([
      {
        provider: "youtube",
        externalId: "external-123",
        title: "Canção",
        channelName: null,
        thumbnailUrl: null,
        duration: null,
        metadata: {},
      },
    ]);
  });
});
