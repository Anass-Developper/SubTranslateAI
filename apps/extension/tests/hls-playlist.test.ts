import { findHlsSubtitleResources, isHlsPlaylist } from "../src/page-bridge/hls-playlist";

describe("découverte des sous-titres HLS", () => {
  it("ne suit que les pistes EXT-X-MEDIA de type SUBTITLES", () => {
    const source = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio/fr.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="fr",URI="subs/fr/index.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=5000000,SUBTITLES="subs"
video/main.m3u8`;

    expect(findHlsSubtitleResources(source, "https://media.example/master.m3u8")).toEqual([
      {
        url: "https://media.example/subs/fr/index.m3u8",
        kind: "playlist",
      },
    ]);
  });

  it("résout les segments relatifs d'une playlist de sous-titres", () => {
    const source = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6.000,
segment-001.vtt?token=test
#EXTINF:6.000,
../shared/segment-002.vtt`;

    expect(
      findHlsSubtitleResources(source, "https://media.example/subs/fr/index.m3u8", true),
    ).toEqual([
      {
        url: "https://media.example/subs/fr/segment-001.vtt?token=test",
        kind: "segment",
      },
      {
        url: "https://media.example/subs/shared/segment-002.vtt",
        kind: "segment",
      },
    ]);
  });

  it("refuse les URI non HTTPS", () => {
    const source = `#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,URI="http://insecure.example/subs.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,URI="data:text/plain,WEBVTT"`;

    expect(findHlsSubtitleResources(source, "https://media.example/master.m3u8")).toEqual([]);
  });

  it("reconnaît le contenu et les types MIME MPEGURL", () => {
    expect(isHlsPlaylist("#EXTM3U\n#EXT-X-VERSION:7")).toBe(true);
    expect(isHlsPlaylist("", "application/vnd.apple.mpegurl")).toBe(true);
    expect(isHlsPlaylist("WEBVTT", "text/vtt")).toBe(false);
  });
});
