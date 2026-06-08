require("dotenv").config();

const express = require("express");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    message: "AI短视频工厂 V1 正常运行",
    hasOpenAIKey: !!process.env.OPENAI_API_KEY
  });
});

app.post("/api/generate", async (req, res) => {
  try {
    const { topic, style, language, duration, platform } = req.body;

    if (!topic) {
      return res.status(400).json({
        ok: false,
        error: "请输入短视频主题"
      });
    }

    // 没有 OPENAI_API_KEY 时，自动进入 Demo 模式，不再崩溃
    if (!process.env.OPENAI_API_KEY) {
      return res.json({
        ok: true,
        demo: true,
        result: createDemoResult(topic, style, language, duration, platform)
      });
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const prompt = `
你是一个专业短视频编导和爆款文案策划。

请根据下面信息生成一条适合短视频平台发布的内容。

主题：${topic}
风格：${style || "爆款口播"}
语言：${language || "中文"}
时长：${duration || "60秒"}
平台：${platform || "TikTok / YouTube Shorts / Reels / 抖音"}

请严格按以下格式输出：

【爆款标题】
给出5个标题。

【视频开头3秒钩子】
必须强吸引注意力。

【完整口播脚本】
适合真人或AI旁白朗读，控制在指定时长。

【分镜脚本】
按镜头1、镜头2、镜头3输出，每个镜头包含：
画面内容：
字幕：
旁白：

【字幕文件】
按短句输出，适合直接贴到视频字幕里。

【发布文案】
适合平台发布，带话题标签。

【封面文案】
给出3个封面大字标题。

要求：
1. 内容要通俗、直接、有吸引力。
2. 不要空话。
3. 不要违法、虚假承诺、夸大收益。
4. 如果是币圈或金融内容，要加入风险提示。
`;

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o",
      messages: [
        {
          role: "system",
          content: "你是专业短视频内容工厂助手，擅长生成爆款短视频脚本、字幕、分镜和发布文案。"
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.8
    });

    const text = completion.choices?.[0]?.message?.content || "生成失败，请重试。";

    res.json({
      ok: true,
      result: text
    });

  } catch (error) {
    console.error("生成失败：", error);

    res.status(500).json({
      ok: false,
      error: error.message || "服务器错误"
    });
  }
});

function createDemoResult(topic, style, language, duration, platform) {
  return `
【当前模式】
Demo 演示模式：当前没有配置 OPENAI_API_KEY，所以系统不会消耗 OpenAI 额度。

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

很多人看到别人做起来了，就马上跟着冲进去，但真正能做起来的人，往往不是最着急的人，而是先把路径想清楚的人。

第一步，不是马上投入大量资金，而是先验证需求。
第二步，不是盲目模仿别人，而是找到适合自己的切入口。
第三步，不是追求一夜成功，而是先做一个最小可用版本。

如果你是新手，建议先从简单版本开始，能跑通，能展示，能收集反馈，再慢慢升级。

记住一句话：先跑通闭环，再谈放大。

【分镜脚本】
镜头1：
画面内容：手机界面、热门短视频、数据增长画面快速切换。
字幕：很多人一开始方向就错了
旁白：很多人做${topic}，一开始方向就错了。

镜头2：
画面内容：手机输入主题，系统自动生成脚本和文案。
字幕：先做最小可用版本
旁白：真正正确的方式，是先做一个能跑通的简单版本。

镜头3：
画面内容：短视频发布页面、评论区、数据反馈。
字幕：跑通闭环，再放大
旁白：先验证，再优化，最后才是批量放大。

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
`;
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`AI短视频工厂 V1 已启动：http://0.0.0.0:${PORT}`);
});
