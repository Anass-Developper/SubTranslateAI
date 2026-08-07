import {
  findDashSubtitleResources,
  isDashManifest,
  parseIsoDuration,
} from "../src/page-bridge/dash-manifest";

const MANIFEST_URL = "https://media.example/vod/index.mpd";

describe("découverte des sous-titres DASH", () => {
  it("reconnaît un manifeste MPD par son contenu ou son type MIME", () => {
    expect(
      isDashManifest('<?xml version="1.0"?>\n<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">'),
    ).toBe(true);
    expect(isDashManifest("", "application/dash+xml; charset=utf-8")).toBe(true);
    expect(isDashManifest("WEBVTT", "text/vtt")).toBe(false);
    expect(isDashManifest("#EXTM3U", "application/vnd.apple.mpegurl")).toBe(false);
  });

  it("reconstruit les segments d'une SegmentTimeline et ignore les pistes audio et vidéo", () => {
    const source = `<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT2M">
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <SegmentTemplate media="video_$Number$.mp4" startNumber="1" duration="2" timescale="1"/>
      <Representation id="v1" bandwidth="4000000"/>
    </AdaptationSet>
    <AdaptationSet contentType="audio" mimeType="audio/mp4" lang="fr">
      <SegmentTemplate media="audio_$Number$.mp4" startNumber="1" duration="2" timescale="1"/>
      <Representation id="a1" bandwidth="128000"/>
    </AdaptationSet>
    <AdaptationSet contentType="text" mimeType="application/mp4" codecs="stpp" lang="fr">
      <SegmentTemplate timescale="1000" media="text/$RepresentationID$/seg_$Number%05d$.m4s" startNumber="1">
        <SegmentTimeline>
          <S t="0" d="60000" r="1"/>
        </SegmentTimeline>
      </SegmentTemplate>
      <Representation id="sub_fr" bandwidth="256"/>
    </AdaptationSet>
  </Period>
</MPD>`;

    const resources = findDashSubtitleResources(source, MANIFEST_URL);
    expect(resources).toHaveLength(2);
    expect(resources.map(({ url }) => url)).toEqual([
      "https://media.example/vod/text/sub_fr/seg_00001.m4s",
      "https://media.example/vod/text/sub_fr/seg_00002.m4s",
    ]);
    expect(new Set(resources.map(({ trackKey }) => trackKey)).size).toBe(1);
    expect(resources.every(({ kind }) => kind === "segment")).toBe(true);
    expect(resources.every(({ language }) => language === "fr")).toBe(true);
  });

  it("substitue $Time$ à partir de la SegmentTimeline", () => {
    const source = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static">
  <Period>
    <AdaptationSet contentType="text" mimeType="application/ttml+xml" lang="en">
      <SegmentTemplate timescale="90000" media="sub_$Time$.ttml">
        <SegmentTimeline>
          <S t="900000" d="5400000"/>
          <S d="5400000"/>
        </SegmentTimeline>
      </SegmentTemplate>
      <Representation id="sub_en"/>
    </AdaptationSet>
  </Period>
</MPD>`;

    expect(findDashSubtitleResources(source, MANIFEST_URL).map(({ url }) => url)).toEqual([
      "https://media.example/vod/sub_900000.ttml",
      "https://media.example/vod/sub_6300000.ttml",
    ]);
  });

  it("calcule le nombre de segments depuis la durée de la présentation", () => {
    const source = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT2M30S">
  <Period>
    <AdaptationSet contentType="text" mimeType="application/mp4" codecs="stpp">
      <SegmentTemplate timescale="1" duration="60" media="seg_$Number$.m4s" startNumber="10"/>
      <Representation id="sub"/>
    </AdaptationSet>
  </Period>
</MPD>`;

    expect(findDashSubtitleResources(source, MANIFEST_URL).map(({ url }) => url)).toEqual([
      "https://media.example/vod/seg_10.m4s",
      "https://media.example/vod/seg_11.m4s",
      "https://media.example/vod/seg_12.m4s",
    ]);
  });

  it("suit les BaseURL hiérarchiques vers un fichier complet", () => {
    const source = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static">
  <BaseURL>https://cdn.example/assets/</BaseURL>
  <Period>
    <AdaptationSet contentType="text" mimeType="application/ttml+xml" lang="fr">
      <Representation id="sub_fr">
        <BaseURL>subs/francais.ttml</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

    expect(findDashSubtitleResources(source, MANIFEST_URL)).toEqual([
      {
        url: "https://cdn.example/assets/subs/francais.ttml",
        kind: "track",
        trackKey: expect.stringContaining("sub_fr"),
        language: "fr",
      },
    ]);
  });

  it("liste les SegmentURL d'une SegmentList", () => {
    const source = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static">
  <Period>
    <AdaptationSet mimeType="text/vtt" lang="de">
      <Representation id="sub_de">
        <SegmentList>
          <SegmentURL media="part-1.vtt"/>
          <SegmentURL media="part-2.vtt"/>
        </SegmentList>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

    expect(findDashSubtitleResources(source, MANIFEST_URL).map(({ url }) => url)).toEqual([
      "https://media.example/vod/part-1.vtt",
      "https://media.example/vod/part-2.vtt",
    ]);
  });

  it("détecte les pistes texte via le rôle subtitle", () => {
    const source = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static">
  <Period>
    <AdaptationSet mimeType="application/mp4">
      <Role schemeIdUri="urn:mpeg:dash:role:2011" value="subtitle"/>
      <Representation id="sub">
        <BaseURL>sub.m4s</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

    expect(findDashSubtitleResources(source, MANIFEST_URL)).toHaveLength(1);
  });

  it("refuse les URL non HTTPS et le XML invalide", () => {
    const insecure = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static">
  <Period>
    <AdaptationSet contentType="text" mimeType="text/vtt">
      <Representation id="sub">
        <BaseURL>http://insecure.example/sub.vtt</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;
    expect(findDashSubtitleResources(insecure, MANIFEST_URL)).toEqual([]);
    expect(findDashSubtitleResources("<MPD><broken", MANIFEST_URL)).toEqual([]);
    expect(findDashSubtitleResources("<html></html>", MANIFEST_URL)).toEqual([]);
  });

  it("analyse les durées ISO 8601", () => {
    expect(parseIsoDuration("PT1H2M3S")).toBe(3_723);
    expect(parseIsoDuration("PT90.5S")).toBe(90.5);
    expect(parseIsoDuration("P1DT1H")).toBe(90_000);
    expect(parseIsoDuration("PT")).toBeUndefined();
    expect(parseIsoDuration("invalide")).toBeUndefined();
  });
});
