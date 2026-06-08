require("dotenv").config();

const express = require("express");
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: "5mb" }));
app.use(express.static("public"));

const OUTPUT_DIR = path.join(__dirname, "public", "outputs");

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const AI_PROVIDER = (process.env.AI_PROVIDER || "demo").toLowerCase();

function getAIClient() {
  if (AI_PROVIDER === "deepseek") {
    if (!process.env.DEEPSEEK_API_KEY) return null;

    return new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: "https://api.deepseek.com"
    });
  }

  if (AI_PROVIDER === "openai") {
    if (!process.env.OPENAI_API_KEY) return null;

    return new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  return null;
}

function getModel() {
  if (AI_PROVIDER === "deepseek") {
    return process.env.DEEPSEEK_MODEL || "deepseek-chat";
  }

  if (AI_PROVIDER === "openai") {
    return process.env.OPENAI_MODEL || "gpt-4o";
  }

  return "demo";
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    version: "V1.5.1",
    message: "AI短视频工厂 V1.5.1 稳定版正常运行",
    provider: AI_PROVIDER,
    model: getModel(),
    hasDeepSeekKey: !!process.env.DEEPSEEK_API_KEY,
    hasOpenAIKey: !!process.env.OPENAI_API_KEY
  });
});

app.post("/api/generate", async (req, res) => {
  try {
    const { topic, style, language, duration, platform } = req.body;

    if (!topic || !topic.trim()) {
      return res.status(400).json({
        ok: false,
        error: "请输入短视频主题"
      });
    }

    const scriptText = await generateScript({
      topic,
      style,
      language,
      duration,
      platform
    });

    const voiceScript = extractVoiceScript(scriptText);
    const srtText = createSrtFromText(voiceScript);

    const id = Date.now().toString();

    const txtFile = path.join(OUTPUT_DIR, `${id}.txt`);
    const srtFile = path.join(OUTPUT_DIR, `${id}.srt`);
    const videoFile = path.join(OUTPUT_DIR, `${id}.mp4`);

    fs.writeFileSync(txtFile, scriptText, "utf-8");
    fs.writeFileSync(srtFile, srtText, "utf-8");

    await createVideo({
      videoFile,
      topic,
      script: voiceScript
    });

    res.json({
      ok: true,
      provider: AI_PROVIDER,
      model: getModel(),
      result: scriptText,
      videoUrl: `/outputs/${id}.mp4`,
      txtUrl: `/outputs/${id}.txt`,
      srtUrl: `/outputs/${id}.srt`
    });

  } catch (error) {
    console.error("生成失败：", error);

    res.status(500).json({
      ok: false,
      error: error.message || "服务器错误"
    });
  }
});

async function generateScript({ topic, style, language, duration, platform }) {
  const client = getAIClient();

  if (!client) {
    return createDemoResult(topic, style, language, duration, platform);
  }

  const prompt = `
你是一个专业短视频编导、爆款文案策划和剪辑导演。

请根据下面信息生成短视频内容。

主题：${topic}
视频风格：${style || "爆款口播"}
语言：${language || "中文"}
视频时长：${duration || "60秒"}
发布平台：${platform || "TikTok / YouTube Shorts / Reels / 抖音 / 快手"}

请严格按照以下结构输出：

【爆款标题】
给出5个标题。

【视频开头3秒钩子】
一句强吸引注意力的话。

【完整口播脚本】
只写适合直接朗读的口播内容。
语言要直接、有节奏、通俗。
不要太长，适合${duration || "60秒"}视频。

【分镜脚本】
至少5个镜头。
每个镜头包含：
画面内容：
字幕：
旁白：
素材建议：

【字幕文件】
按短句输出，每句不要太长。

【发布文案】
适合平台发布，带话题标签。
如果是币圈、金融、投资相关内容，必须加入风险提示。

【封面文案】
给出3个封面大字标题。

【剪辑建议】
给出背景、音乐、字幕、节奏建议。

要求：
1. 不要承诺稳赚、暴富、100%收益。
2. 不要编造真实新闻数据。
3. 如果是币圈或金融内容，只做分析和风险提醒。
4. 内容要像能直接发布的短视频脚本。
`;

  const completion = await client.chat.completions.create({
    model: getModel(),
    messages: [
      {
        role: "system",
        content: "你是专业短视频内容工厂助手，擅长生成爆款标题、口播脚本、分镜、字幕和发布文案。"
      },
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: 0.8,
    max_tokens: 2500
  });

  return completion.choices?.[0]?.message?.content || createDemoResult(topic);
}

function extractVoiceScript(fullText) {
  const match = fullText.match(/【完整口播脚本】([\s\S]*?)(【分镜脚本】|【字幕文件】|$)/);

  let text = match ? match[1].trim() : fullText;

  text = text
    .replace(/【.*?】/g, "")
    .replace(/镜头\d+[:：]/g, "")
    .replace(/画面内容[:：]/g, "")
    .replace(/字幕[:：]/g, "")
    .replace(/旁白[:：]/g, "")
    .replace(/素材建议[:：]/g, "")
    .replace(/#\S+/g, "")
    .replace(/\r/g, "")
    .trim();

  if (text.length > 500) {
    text = text.slice(0, 500);
  }

  return text || "这是 AI短视频工厂 自动生成的视频内容。";
}

function createSrtFromText(text) {
  const sentences = text
    .replace(/\n+/g, "。")
    .split(/[。！？!?]/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 20);

  let srt = "";
  let start = 0;

  sentences.forEach((sentence, index) => {
    const dur = Math.max(3, Math.min(6, Math.ceil(sentence.length / 6)));
    const end = start + dur;

    srt += `${index + 1}\n`;
    srt += `${formatTime(start)} --> ${formatTime(end)}\n`;
    srt += `${sentence}\n\n`;

    start = end;
  });

  return srt;
}

function formatTime(sec) {
  const h = String(Math.floor(sec / 3600)).padStart(2, "0");
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${h}:${m}:${s},000`;
}

function createVideo({ videoFile, topic, script }) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input("color=c=0f172a:s=720x1280:r=30:d=18")
      .inputFormat("lavfi")
      .outputOptions([
        "-c:v libx264",
        "-pix_fmt yuv420p",
        "-movflags +faststart"
      ])
      .save(videoFile)
      .on("end", () => resolve())
      .on("error", err => reject(err));
  });
}
function cleanDrawText(text) {
function createDemoResult(topic, style, language, duration, platform) {
  return `
【当前模式】
Demo 演示模式：当前没有配置可用 AI API Key，但系统会继续生成基础 MP4 视频。

【爆款标题】
1. ${topic}，普通人现在还能不能做？
2. 别再盲目跟风了，${topic}真正的关键在这里
3. 新手做${topic}，一定要先看这几点
4. ${topic}为什么突然被很多人关注？
5. 3分钟看懂${topic}的底层逻辑

【视频开头3秒钩子】
很多人做${topic}，一开始方向就错了。

【完整口播脚本】
今天讲一个非常现实的话题：${topic}。

很多人看到别人做起来了，就马上跟着冲进去。但真正能做起来的人，往往不是最着急的人，而是先把路径想清楚的人。

第一步，不是马上投入大量资金，而是先验证需求。

第二步，不是盲目模仿别人，而是找到适合自己的切入口。

第三步，不是追求一夜成功，而是先做一个最小可用版本。

如果你是新手，建议先从简单版本开始。能跑通，能展示，能收集反馈，再慢慢升级。

记住一句话：先跑通闭环，再谈放大。

【分镜脚本】
镜头1：
画面内容：手机界面、热门短视频、数据增长画面快速切换。
字幕：很多人一开始方向就错了
旁白：很多人做${topic}，一开始方向就错了。
素材建议：手机录屏、短视频平台截图。

镜头2：
画面内容：手机输入主题，系统自动生成脚本和文案。
字幕：先做最小可用版本
旁白：真正正确的方式，是先做一个能跑通的简单版本。
素材建议：AI工具页面、输入框、生成结果画面。

镜头3：
画面内容：短视频发布页面、评论区、数据反馈。
字幕：跑通闭环，再放大
旁白：先验证，再优化，最后才是批量放大。
素材建议：发布界面、评论区、点赞数据。

【字幕文件】
很多人做${topic}，一开始方向就错了。
不是马上投钱。
不是盲目模仿。
而是先做一个最小可用版本。
能跑通，能展示，能收集反馈。
再慢慢升级。
先跑通闭环，再谈放大。

【发布文案】
新手做${topic}，不要一上来就追求复杂系统。先做简单版，跑通流程，再逐步升级。
#AI工具 #短视频创业 #内容工厂 #副业项目 #自动化

【封面文案】
1. ${topic}新手必看
2. 先别急着投钱
3. 跑通闭环最重要

【剪辑建议】
竖屏9:16，深色背景，大字幕，高节奏，前3秒制造冲突感。
`;
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`AI短视频工厂 V1.5.1 已启动：http://0.0.0.0:${PORT}`);
});
