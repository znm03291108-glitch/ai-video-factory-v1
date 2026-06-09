const express = require("express");
const cors = require("cors");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";

function fallbackScript(topic, style, duration) {
  return {
    title: `${topic}，普通人一定要看懂`,
    hook: `很多人看到${topic}，第一反应就是跟风，但真正关键不是情绪，而是逻辑。`,
    script:
      `今天讲一个非常现实的话题：${topic}。\n\n` +
      `很多人一看到市场波动，就马上冲进去，结果往往不是赚钱，而是被情绪带着走。\n\n` +
      `第一，要先看原因。是消息面影响，还是资金面变化，还是市场情绪集中释放。\n\n` +
      `第二，要看位置。价格已经涨了很多再追，风险就会变大；价格已经跌了很多再恐慌，也容易卖在低点。\n\n` +
      `第三，要看自己的资金。短线可以观察机会，但千万不要满仓，不要借钱，不要把希望全部压在一次判断上。\n\n` +
      `真正能长期活下来的人，不是每次都猜对方向的人，而是每次都知道自己最多能亏多少的人。\n\n` +
      `所以面对${topic}，不要只问能不能涨，要先问自己：如果判断错了，我能不能承受。`,
    subtitles: [
      `今天讲一个现实话题：${topic}`,
      `很多人一看到波动就冲进去`,
      `但真正关键不是涨跌，而是逻辑`,
      `第一，看消息面和资金面`,
      `第二，看价格所在的位置`,
      `第三，看自己的资金承受能力`,
      `不要满仓，不要借钱，不要情绪化操作`,
      `长期活下来，比一次猜对更重要`
    ]
  };
}

function splitToSubtitles(text) {
  const clean = String(text || "")
    .replace(/\r/g, "")
    .replace(/[【】#*]/g, "")
    .split(/\n|。|！|？|；|;/)
    .map(s => s.trim())
    .filter(Boolean);

  const result = [];
  for (const line of clean) {
    if (line.length <= 24) {
      result.push(line);
    } else {
      for (let i = 0; i < line.length; i += 22) {
        result.push(line.slice(i, i + 22));
      }
    }
  }
  return result.slice(0, 18);
}

function splitTtsText(text) {
  const raw = String(text || "")
    .replace(/\r/g, "")
    .replace(/\n+/g, "。")
    .replace(/\s+/g, " ")
    .trim();

  const pieces = raw
    .split(/。|！|？|；|;/)
    .map(s => s.trim())
    .filter(Boolean);

  const chunks = [];
  let current = "";

  for (const p of pieces) {
    const sentence = p + "。";
    if ((current + sentence).length > 180) {
      if (current) chunks.push(current);
      current = sentence;
    } else {
      current += sentence;
    }
  }

  if (current) chunks.push(current);

  return chunks.slice(0, 12);
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    version: "1.7.0",
    hasGoogleKey: Boolean(GOOGLE_API_KEY),
    model: GEMINI_MODEL,
    tts: "google-translate-tts-fallback"
  });
});

app.post("/api/generate-script", async (req, res) => {
  try {
    const { topic, style, language, duration, platform } = req.body || {};

    if (!topic || !String(topic).trim()) {
      return res.status(400).json({ error: "请输入短视频主题" });
    }

    if (!GOOGLE_API_KEY) {
      const data = fallbackScript(topic, style, duration);
      return res.json({
        mode: "fallback",
        message: "未配置 GOOGLE_API_KEY，已使用本地演示文案。",
        ...data
      });
    }

    const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    const prompt = `
你是一个短视频爆款文案专家。请根据下面主题生成短视频脚本。

主题：${topic}
风格：${style || "热点分析"}
语言：${language || "中文"}
时长：${duration || "60秒"}
平台：${platform || "通用短视频平台"}

要求：
1. 生成一个吸引人的标题
2. 生成一个3秒开头钩子
3. 生成完整口播脚本，适合短视频配音朗读
4. 生成8到12条短字幕，每条字幕不要太长
5. 内容要通俗、直接、有节奏
6. 如果涉及投资、币圈、交易，不要承诺收益，要提醒风险

请严格返回 JSON，不要加 Markdown，不要加代码块：
{
  "title": "标题",
  "hook": "开头钩子",
  "script": "完整口播脚本",
  "subtitles": ["字幕1","字幕2","字幕3"]
}
`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    let jsonText = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    let data;
    try {
      data = JSON.parse(jsonText);
    } catch (e) {
      data = {
        title: `${topic}，普通人一定要看懂`,
        hook: `很多人对${topic}只看表面，真正关键在底层逻辑。`,
        script: text,
        subtitles: splitToSubtitles(text)
      };
    }

    if (!Array.isArray(data.subtitles) || data.subtitles.length === 0) {
      data.subtitles = splitToSubtitles(data.script);
    }

    res.json({
      mode: "gemini",
      title: data.title || `${topic}短视频`,
      hook: data.hook || "",
      script: data.script || "",
      subtitles: data.subtitles.slice(0, 18)
    });
  } catch (err) {
    console.error("generate-script error:", err);
    const { topic, style, duration } = req.body || {};
    const data = fallbackScript(topic || "短视频主题", style, duration);
    res.json({
      mode: "error-fallback",
      message: "Gemini 调用失败，已使用本地备用文案。",
      ...data
    });
  }
});

app.post("/api/tts", async (req, res) => {
  try {
    const { text, lang } = req.body || {};

    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: "缺少配音文本" });
    }

    const chunks = splitTtsText(text);
    const tl = lang === "en" ? "en-US" : "zh-CN";

    const audioChunks = [];

    for (const chunk of chunks) {
      const url =
        "https://translate.google.com/translate_tts" +
        "?ie=UTF-8" +
        "&client=tw-ob" +
        `&tl=${encodeURIComponent(tl)}` +
        `&q=${encodeURIComponent(chunk)}`;

      const r = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          "Referer": "https://translate.google.com/"
        }
      });

      if (!r.ok) {
        throw new Error("TTS 请求失败：" + r.status);
      }

      const ab = await r.arrayBuffer();
      const base64 = Buffer.from(ab).toString("base64");

      audioChunks.push({
        text: chunk,
        mime: "audio/mpeg",
        base64
      });
    }

    res.json({
      ok: true,
      mode: "tts",
      chunks: audioChunks
    });
  } catch (err) {
    console.error("tts error:", err);
    res.status(500).json({
      ok: false,
      error: "配音生成失败",
      detail: err.message
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`AI Video Factory V1.7 running on port ${PORT}`);
});
