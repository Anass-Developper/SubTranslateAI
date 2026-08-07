import {
  detectTrackFormat,
  looksLikeBilibiliSubtitle,
  parseBilibiliSubtitle,
  parseSrt,
  parseSubtitleTrack,
  parseTtml,
  parseWebVtt,
  parseYouTubeTimedText,
  type Cue,
} from "../src/tracks";

describe("parseurs de pistes de sous-titres", () => {
  describe("WebVTT", () => {
    it("lit l'en-tête, les identifiants, les réglages et le balisage", () => {
      const source = `\uFEFFWEBVTT - exemple
Kind: captions
Language: fr

NOTE ceci est ignoré
00:00.000 --> 00:00.500
texte de note

intro
00:01.250 --> 00:03.500 position:50% align:middle
<v Narrateur><b>Bonjour</b> &amp; bienvenue
sur la deuxième ligne

01:02:03.004 --> 01:02:05.040
Fin`;

      expect(parseWebVtt(source)).toEqual([
        {
          id: "intro",
          startMs: 1_250,
          endMs: 3_500,
          text: "Bonjour & bienvenue\nsur la deuxième ligne",
        },
        { id: "vtt-2", startMs: 3_723_004, endMs: 3_725_040, text: "Fin" },
      ] satisfies Cue[]);
    });

    it("écarte sans lever d'erreur les timecodes et durées invalides", () => {
      expect(
        parseWebVtt(`WEBVTT

00:70.000 --> 00:71.000
invalide

00:02.000 --> 00:01.000
durée négative`),
      ).toEqual([]);
    });

    it("aligne les segments HLS avec X-TIMESTAMP-MAP et l'horloge MPEGTS à 90 kHz", () => {
      const source = `WEBVTT
X-TIMESTAMP-MAP=LOCAL:00:00:02.000,MPEGTS:900000

segment
00:03.000 --> 00:04.250
Sous-titre aligné`;

      expect(parseWebVtt(source)).toEqual([
        {
          id: "segment",
          startMs: 11_000,
          endMs: 12_250,
          text: "Sous-titre aligné",
        },
      ]);
    });
  });

  describe("SubRip/SRT", () => {
    it("accepte virgules ou points, identifiant absent et balises courantes", () => {
      const source = `1
00:00:01,050 --> 00:00:02,500
{\\an8}<i>Salut&nbsp;!</i>

00:03.5 --> 00:05.050
Ligne 1<br>Ligne 2`;

      expect(parseSrt(source)).toEqual([
        { id: "1", startMs: 1_050, endMs: 2_500, text: "Salut !" },
        { id: "srt-2", startMs: 3_500, endMs: 5_050, text: "Ligne 1\nLigne 2" },
      ]);
    });

    it("rend les identifiants dupliqués uniques", () => {
      const source = `même
00:00:01,000 --> 00:00:02,000
Un

même
00:00:03,000 --> 00:00:04,000
Deux`;
      expect(parseSrt(source).map((cue) => cue.id)).toEqual(["même", "même-2"]);
    });

    it("tolère des blocs qui ne sont pas séparés par une ligne vide", () => {
      const source = `1
00:00:01,000 --> 00:00:02,000
Un
2
00:00:03,000 --> 00:00:04,000
Deux`;
      expect(parseSrt(source).map((cue) => cue.text)).toEqual(["Un", "Deux"]);
    });
  });

  describe("TTML, DFXP et IMSC", () => {
    it("gère namespaces, temps hérités, durées, retours et entités XML", () => {
      const source = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter"
    xmlns:xml="http://www.w3.org/XML/1998/namespace" ttp:frameRate="25">
  <body begin="1s"><div>
    <p xml:id="premier" begin="2s" dur="1.5s"><span>Bonjour</span><br/>le monde &#38; tous</p>
    <p begin="00:00:04:12" end="00:00:06:00">Aux frames</p>
  </div></body>
</tt>`;

      expect(parseTtml(source)).toEqual([
        {
          id: "premier",
          startMs: 3_000,
          endMs: 4_500,
          text: "Bonjour\nle monde & tous",
        },
        { id: "ttml-2", startMs: 5_480, endMs: 7_000, text: "Aux frames" },
      ]);
    });

    it("prend en charge tickRate, frameRateMultiplier et infère une fin manquante", () => {
      const source = `<tt xmlns="http://www.w3.org/ns/ttml"
        xmlns:ttp="http://www.w3.org/ns/ttml#parameter"
        ttp:frameRate="30" ttp:frameRateMultiplier="1000 1001" ttp:tickRate="10">
        <body><div>
          <p begin="20t">Ticks</p>
          <p begin="75f" dur="1s">Frames</p>
        </div></body>
      </tt>`;
      const cues = parseTtml(source);
      expect(cues[0]).toEqual({ id: "ttml-1", startMs: 2_000, endMs: 2_502.5, text: "Ticks" });
      expect(cues[1]?.startMs).toBeCloseTo(2_502.5, 5);
      expect(cues[1]?.endMs).toBeCloseTo(3_502.5, 5);
    });

    it("renvoie une liste vide pour un XML mal formé", () => {
      expect(parseTtml("<tt><body><p begin='1s'>cassé</body></tt>")).toEqual([]);
    });
  });

  describe("JSON timedtext YouTube", () => {
    it("lit JSON3, concatène les segments et infère une durée absente", () => {
      const source = `)]}'
{"events":[
  {"tStartMs":1000,"segs":[{"utf8":"Bonjour"},{"utf8":" le monde"}]},
  {"tStartMs":2500,"dDurationMs":1800,"segs":[{"utf8":"Deuxième ligne"}]},
  {"tStartMs":3000,"dDurationMs":1000}
]}`;

      expect(parseYouTubeTimedText(source)).toEqual([
        { id: "yt-1", startMs: 1_000, endMs: 2_500, text: "Bonjour le monde" },
        { id: "yt-2", startMs: 2_500, endMs: 4_300, text: "Deuxième ligne" },
      ]);
    });

    it("lit les transcriptCueRenderer à texte simple ou runs", () => {
      const source = {
        actions: [
          {
            updateEngagementPanelAction: {
              content: {
                transcriptRenderer: {
                  body: {
                    cueGroups: [
                      {
                        transcriptCueGroupRenderer: {
                          cues: [
                            {
                              transcriptCueRenderer: {
                                cueId: "cue-a",
                                startOffsetMs: "1200",
                                durationMs: "900",
                                cue: { runs: [{ text: "Bon" }, { text: "jour" }] },
                              },
                            },
                            {
                              transcriptCueRenderer: {
                                startOffsetMs: "2200",
                                durationMs: "1000",
                                cue: { simpleText: "Suite" },
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        ],
      };

      expect(parseYouTubeTimedText(source)).toEqual([
        { id: "cue-a", startMs: 1_200, endMs: 2_100, text: "Bonjour" },
        { id: "yt-2", startMs: 2_200, endMs: 3_200, text: "Suite" },
      ]);
    });

    it("accepte une liste JSON générique et ne lève pas sur du JSON invalide", () => {
      expect(
        parseYouTubeTimedText([
          { start: 1.25, duration: 2, text: "Une &amp; deux" },
          { startMs: 4_000, endMs: 4_800, text: "Fin" },
        ]),
      ).toEqual([
        { id: "yt-1", startMs: 1_250, endMs: 3_250, text: "Une & deux" },
        { id: "yt-2", startMs: 4_000, endMs: 4_800, text: "Fin" },
      ]);
      expect(parseYouTubeTimedText("pas du json")).toEqual([]);
    });

    it("lit également le format XML timedtext historique", () => {
      expect(
        parseYouTubeTimedText(
          `<transcript><text start="1.25" dur="2">Une &amp; deux</text><text start="4">Fin</text></transcript>`,
        ),
      ).toEqual([
        { id: "yt-1", startMs: 1_250, endMs: 3_250, text: "Une & deux" },
        { id: "yt-2", startMs: 4_000, endMs: 9_000, text: "Fin" },
      ]);
    });
  });

  describe("JSON Bilibili", () => {
    const source = JSON.stringify({
      font_size: 0.4,
      type: "AIsubtitle",
      lang: "zh-CN",
      body: [
        { from: 4.19, to: 5.27, sid: 1, location: 2, content: "我不知道你在这里。" },
        { from: 6.5, to: 8.1, sid: 2, location: 2, content: "你还好吗？" },
        { from: -1, to: 2, sid: 3, content: "ignorée" },
        { from: 9, sid: 4, content: "sans fin explicite" },
      ],
    });

    it("convertit les secondes en millisecondes et conserve l'ordre", () => {
      expect(parseBilibiliSubtitle(source)).toEqual([
        { id: "1", startMs: 4_190, endMs: 5_270, text: "我不知道你在这里。" },
        { id: "2", startMs: 6_500, endMs: 8_100, text: "你还好吗？" },
        { id: "4", startMs: 9_000, endMs: 14_000, text: "sans fin explicite" },
      ]);
    });

    it("est reconnu par la détection de format", () => {
      expect(looksLikeBilibiliSubtitle(source)).toBe(true);
      expect(detectTrackFormat(source)).toBe("bilibili-json");
      expect(detectTrackFormat('{"events":[{"tStartMs":0,"segs":[]}]}')).toBe("youtube-json");
    });

    it("ne lève pas sur du JSON invalide ou étranger", () => {
      expect(parseBilibiliSubtitle("{pas du json")).toEqual([]);
      expect(parseBilibiliSubtitle('{"data": []}')).toEqual([]);
      expect(parseBilibiliSubtitle(42)).toEqual([]);
    });
  });

  it("expose un point d'entrée commun avec les alias de format", () => {
    const ttml = `<tt><body><p begin="1s" dur="1s">Texte</p></body></tt>`;
    expect(parseSubtitleTrack(ttml, "dfxp")).toEqual(parseTtml(ttml));
    expect(parseSubtitleTrack({}, "vtt")).toEqual([]);
    expect(
      parseSubtitleTrack('{"body":[{"from":1,"to":2,"content":"哈喽"}]}', "bilibili-json"),
    ).toEqual([{ id: "bili-1", startMs: 1_000, endMs: 2_000, text: "哈喽" }]);
  });
});
