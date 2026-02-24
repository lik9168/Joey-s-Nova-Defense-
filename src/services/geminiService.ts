import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const getGameTips = async (score: number, language: 'en' | 'zh') => {
  try {
    const prompt = language === 'en' 
      ? `The player just finished a game of Missile Command with a score of ${score}. Give a very short, encouraging tip (max 15 words) for the next game.`
      : `玩家刚刚完成了一场导弹防御游戏，得分是 ${score}。请给出一个简短的鼓励性建议（最多20字），用于下一局。`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error("Failed to get AI tips", error);
    return null;
  }
};
