const ALLOWED_MODELS = {
  openai: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"],
  anthropic: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001"]
};

const DEFAULT_MODELS = {
  openai: "gpt-5.4",
  anthropic: "claude-sonnet-4-6"
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "GENERATE_ANSWERS") {
    return undefined;
  }

  handleAnswerGeneration(message.payload)
    .then((answers) => {
      sendResponse({ ok: true, answers });
    })
    .catch((error) => {
      sendResponse({ ok: false, error: error.message || "Ошибка генерации ответов." });
    });

  return true;
});

async function handleAnswerGeneration(payload) {
  const incomingSettings = payload?.settings || {};
  const storedSettings = await getStoredSettings();
  const settings = {
    ...storedSettings,
    ...incomingSettings
  };
  settings.provider = settings.provider === "anthropic" ? "anthropic" : "openai";
  settings.openaiModel = normalizeModelValue("openai", settings.openaiModel);
  settings.anthropicModel = normalizeModelValue("anthropic", settings.anthropicModel);

  const questions = Array.isArray(payload?.questions) ? payload.questions : [];

  if (!questions.length) {
    throw new Error("В форме не найдены поддерживаемые вопросы.");
  }

  const userPrompt = buildUserPrompt(questions, settings.userContext || "");
  const systemPrompt = buildSystemPrompt(settings.extraInstructions || "");

  let responseJson;

  if (settings.provider === "openai") {
    responseJson = await callOpenAI({
      apiKey: settings.openaiApiKey,
      model: settings.openaiModel,
      temperature: settings.temperature,
      systemPrompt,
      userPrompt
    });
  } else if (settings.provider === "anthropic") {
    responseJson = await callAnthropic({
      apiKey: settings.anthropicApiKey,
      model: settings.anthropicModel,
      temperature: settings.temperature,
      systemPrompt,
      userPrompt
    });
  } else {
    throw new Error("Провайдер не выбран. Выберите OpenAI или Anthropic.");
  }

  return normalizeAnswers(responseJson, questions);
}

function getStoredSettings() {
  const keys = [
    "provider",
    "openaiApiKey",
    "openaiModel",
    "anthropicApiKey",
    "anthropicModel",
    "userContext",
    "extraInstructions",
    "temperature"
  ];

  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, (data) => {
      resolve(data || {});
    });
  });
}

function buildSystemPrompt(extraInstructions) {
  const lines = [
    "Ты помощник для автозаполнения Google Forms.",
    "Верни только JSON. Никаких пояснений, markdown и дополнительных полей.",
    "Используй только предоставленные варианты ответа для single_choice и multiple_choice.",
    "Для multiple_choice строго соблюдай selectionRules (exactSelections/minSelections/maxSelections).",
    "Никогда не выбирай больше maxSelections и всегда выбирай ровно exactSelections, если это задано.",
    "Формат ответа: {\"answers\": [{\"id\": \"q_1\", \"answer\": \"...\"}]}",
    "Для multiple_choice поле answer должно быть массивом строк."
  ];

  if (extraInstructions.trim()) {
    lines.push(`Дополнительные инструкции пользователя: ${extraInstructions.trim()}`);
  }

  return lines.join(" ");
}

function buildUserPrompt(questions, userContext) {
  const payload = {
    userContext: userContext || "",
    questions
  };

  return [
    "Заполни форму на основе контекста пользователя.",
    "Если контекст недостаточен, дай правдоподобные нейтральные ответы.",
    "Для вопросов типа single_choice выбирай только один вариант.",
    "Для вопросов типа multiple_choice выбирай варианты только из options с учетом selectionRules.",
    "Если exactSelections задано, верни ровно это количество вариантов.",
    "Если maxSelections задано, не превышай это количество вариантов.",
    "Ниже JSON с вопросами:",
    JSON.stringify(payload, null, 2)
  ].join("\n\n");
}

async function callOpenAI({ apiKey, model, temperature, systemPrompt, userPrompt }) {
  if (!apiKey) {
    throw new Error("Не указан OpenAI API key.");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: normalizeModelValue("openai", model),
      temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(extractApiError(body, "OpenAI API вернул ошибку."));
  }

  const content = body?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI API вернул пустой ответ.");
  }

  return parseResponseJson(content);
}

async function callAnthropic({ apiKey, model, temperature, systemPrompt, userPrompt }) {
  if (!apiKey) {
    throw new Error("Не указан Anthropic API key.");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: normalizeModelValue("anthropic", model),
      max_tokens: 1500,
      temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.2,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt
        }
      ]
    })
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(extractApiError(body, "Anthropic API вернул ошибку."));
  }

  const content = Array.isArray(body?.content)
    ? body.content
        .filter((part) => part?.type === "text")
        .map((part) => part.text)
        .join("\n")
    : "";

  if (!content) {
    throw new Error("Anthropic API вернул пустой ответ.");
  }

  return parseResponseJson(content);
}

function parseResponseJson(rawText) {
  if (typeof rawText !== "string") {
    if (rawText && typeof rawText === "object") {
      return rawText;
    }

    throw new Error("Ответ API не содержит JSON.");
  }

  const cleaned = stripCodeFences(rawText.trim());

  try {
    return JSON.parse(cleaned);
  } catch {
    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");

    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
      throw new Error("Не удалось извлечь JSON из ответа модели.");
    }

    const jsonSlice = cleaned.slice(jsonStart, jsonEnd + 1);
    return JSON.parse(jsonSlice);
  }
}

function normalizeAnswers(responseJson, questions) {
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const questionByText = new Map(
    questions.map((question) => [normalizeMatchValue(question.text), question.id])
  );

  const rawAnswers = extractRawAnswers(responseJson);
  const normalizedAnswers = [];

  for (const item of rawAnswers) {
    if (!item || typeof item !== "object") {
      continue;
    }

    let id = typeof item.id === "string" ? item.id : "";
    if (!id && typeof item.question === "string") {
      id = questionByText.get(normalizeMatchValue(item.question)) || "";
    }

    if (!id || !questionById.has(id)) {
      continue;
    }

    const question = questionById.get(id);
    let answer = item.answer;

    if (question.type === "multiple_choice") {
      if (typeof answer === "string") {
        answer = answer
          .split(/[,;\n]/)
          .map((entry) => entry.trim())
          .filter(Boolean);
      }

      if (!Array.isArray(answer)) {
        answer = [];
      }

      answer = enforceSelectionRules(
        answer.map((entry) => String(entry)),
        question.selectionRules,
        question.options
      );
    } else {
      if (Array.isArray(answer)) {
        answer = answer.length ? String(answer[0]) : "";
      } else if (answer === undefined || answer === null) {
        answer = "";
      } else {
        answer = String(answer);
      }
    }

    normalizedAnswers.push({ id, answer });
  }

  return normalizedAnswers;
}

function enforceSelectionRules(answerList, selectionRules, options) {
  const normalizedAnswers = uniqueNormalizedList(answerList);
  const normalizedOptions = uniqueNormalizedList(Array.isArray(options) ? options : []);
  const optionMap = new Map(normalizedOptions.map((value) => [normalizeMatchValue(value), value]));

  const filteredToOptions = [];
  const seen = new Set();

  for (const answer of normalizedAnswers) {
    const normalizedAnswer = normalizeMatchValue(answer);
    if (!normalizedAnswer) {
      continue;
    }

    const direct = optionMap.get(normalizedAnswer);
    if (direct && !seen.has(normalizeMatchValue(direct))) {
      seen.add(normalizeMatchValue(direct));
      filteredToOptions.push(direct);
      continue;
    }

    const partial = normalizedOptions.find((option) => {
      const normalizedOption = normalizeMatchValue(option);
      if (!normalizedOption || normalizedOption.length < 4 || normalizedAnswer.length < 4) {
        return false;
      }

      return normalizedOption.includes(normalizedAnswer) || normalizedAnswer.includes(normalizedOption);
    });

    if (partial && !seen.has(normalizeMatchValue(partial))) {
      seen.add(normalizeMatchValue(partial));
      filteredToOptions.push(partial);
    }
  }

  const exactSelections = normalizeRuleNumber(selectionRules?.exactSelections);
  const maxSelections = normalizeRuleNumber(selectionRules?.maxSelections);

  if (exactSelections && filteredToOptions.length > exactSelections) {
    return filteredToOptions.slice(0, exactSelections);
  }

  if (maxSelections && filteredToOptions.length > maxSelections) {
    return filteredToOptions.slice(0, maxSelections);
  }

  return filteredToOptions;
}

function uniqueNormalizedList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const result = [];
  const seen = new Set();

  for (const value of values) {
    const asText = String(value || "").trim();
    if (!asText) {
      continue;
    }

    const normalized = normalizeMatchValue(asText);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(asText);
  }

  return result;
}

function normalizeRuleNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return 0;
  }

  return Math.floor(number);
}

function extractRawAnswers(responseJson) {
  if (Array.isArray(responseJson?.answers)) {
    return responseJson.answers;
  }

  if (responseJson?.answers && typeof responseJson.answers === "object") {
    return Object.entries(responseJson.answers).map(([id, answer]) => ({ id, answer }));
  }

  if (Array.isArray(responseJson)) {
    return responseJson;
  }

  if (responseJson && typeof responseJson === "object") {
    const keys = Object.keys(responseJson).filter((key) => key.startsWith("q_"));
    if (keys.length) {
      return keys.map((key) => ({ id: key, answer: responseJson[key] }));
    }
  }

  throw new Error("API вернул JSON в неожиданном формате.");
}

function stripCodeFences(value) {
  if (!value.startsWith("```")) {
    return value;
  }

  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function normalizeMatchValue(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function extractApiError(body, fallbackMessage) {
  return body?.error?.message || body?.message || fallbackMessage;
}

function normalizeModelValue(provider, model) {
  const allowed = ALLOWED_MODELS[provider] || [];
  if (allowed.includes(model)) {
    return model;
  }

  return DEFAULT_MODELS[provider];
}
