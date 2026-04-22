chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "START_AUTOFILL") {
    return undefined;
  }

  runAutofill(message.settings)
    .then((result) => {
      sendResponse({ ok: true, ...result });
    })
    .catch((error) => {
      sendResponse({ ok: false, error: error.message || "Ошибка автозаполнения." });
    });

  return true;
});

async function runAutofill(settings) {
  const questions = collectSupportedQuestions();

  if (!questions.length) {
    throw new Error("Поддерживаемые вопросы не найдены. Нужны текстовые, single choice или multiple choice.");
  }

  const payloadQuestions = questions.map(({ element, ...question }) => question);

  const aiResponse = await chrome.runtime.sendMessage({
    type: "GENERATE_ANSWERS",
    payload: {
      settings,
      questions: payloadQuestions
    }
  });

  if (!aiResponse || !aiResponse.ok) {
    throw new Error(aiResponse?.error || "Не удалось получить ответы от ИИ.");
  }

  const stats = applyAnswers(questions, aiResponse.answers || []);

  return {
    questionsFound: questions.length,
    answersApplied: stats.applied,
    unanswered: stats.unanswered
  };
}

function collectSupportedQuestions() {
  const listItems = Array.from(document.querySelectorAll('div[role="listitem"]'));
  const result = [];

  let index = 1;

  for (const item of listItems) {
    if (!isElementVisible(item)) {
      continue;
    }

    const type = detectQuestionType(item);
    if (!type) {
      continue;
    }

    const text = getQuestionTitle(item) || `Вопрос ${index}`;
    const options = type === "text" ? [] : getOptions(item, type);
    const hintText = getQuestionHintText(item, text);
    const selectionRules =
      type === "multiple_choice" ? extractSelectionRules(`${text} ${hintText}`, options.length) : null;

    if (type !== "text" && !options.length) {
      continue;
    }

    result.push({
      id: `q_${index}`,
      text,
      type,
      options,
      hintText,
      selectionRules,
      required: isRequiredQuestion(item),
      element: item
    });

    index += 1;
  }

  return result;
}

function detectQuestionType(item) {
  if (item.querySelectorAll('[role="checkbox"]').length) {
    return "multiple_choice";
  }

  if (item.querySelectorAll('[role="radio"]').length) {
    return "single_choice";
  }

  if (item.querySelector('textarea, input[type="text"], input[type="email"], input[type="number"], input[type="url"]')) {
    return "text";
  }

  return null;
}

function getQuestionTitle(item) {
  const selectors = [
    '[role="heading"]',
    '.M7eMe',
    '.HoXoMd',
    'div[aria-level="3"]'
  ];

  for (const selector of selectors) {
    const element = item.querySelector(selector);
    const text = normalizeText(element?.innerText || element?.textContent || "");
    if (text) {
      return text;
    }
  }

  return "";
}

function getQuestionHintText(item, titleText) {
  const selectors = [
    '[aria-describedby]',
    '.gubaDc',
    '.vQES8d',
    '.nWQGrd',
    '.RHiWt'
  ];

  const collected = [];

  for (const selector of selectors) {
    for (const element of item.querySelectorAll(selector)) {
      const text = normalizeText(element?.innerText || element?.textContent || "");
      if (text) {
        collected.push(text);
      }
    }
  }

  const fallback = normalizeText(item.innerText || item.textContent || "");
  if (fallback) {
    collected.push(fallback);
  }

  const normalizedTitle = normalizeMatchValue(titleText);
  const unique = [];
  const seen = new Set();

  for (const text of collected) {
    const normalized = normalizeMatchValue(text);
    if (!normalized || normalized === normalizedTitle || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    unique.push(text);
  }

  return unique.join(" | ");
}

function extractSelectionRules(rawText, optionsCount) {
  const text = normalizeConstraintText(rawText);
  if (!text) {
    return null;
  }

  let minSelections = clampRuleNumber(
    parseInstructionNumber(text, [
      /(?:не\s+менее|минимум|at\s+least|min(?:imum)?)\s+(\d{1,2})/i,
      /(?:выберите|выбери|choose|select|pick)\s+минимум\s+(\d{1,2})/i
    ]),
    optionsCount
  );

  let maxSelections = clampRuleNumber(
    parseInstructionNumber(text, [
      /(?:не\s+более|максимум|at\s+most|up\s+to|max(?:imum)?)\s+(\d{1,2})/i,
      /(?:до)\s+(\d{1,2})\s+(?:вариант(?:а|ов)?|ответ(?:а|ов)?|options?|answers?)/i
    ]),
    optionsCount
  );

  let exactSelections = clampRuleNumber(
    parseInstructionNumber(text, [
      /(?:ровно|exactly)\s+(\d{1,2})/i,
      /(?:выберите|выбери|choose|select|pick)\s+(\d{1,2})\s+(?:вариант(?:а|ов)?|ответ(?:а|ов)?|options?|answers?)/i
    ]),
    optionsCount
  );

  if (!exactSelections && !minSelections && !maxSelections) {
    exactSelections = clampRuleNumber(
      parseInstructionNumber(text, [/(?:выберите|выбери|choose|select|pick)\s+(\d{1,2})\b/i]),
      optionsCount
    );
  }

  if (exactSelections) {
    minSelections = exactSelections;
    maxSelections = exactSelections;
  }

  if (minSelections && maxSelections && minSelections > maxSelections) {
    minSelections = maxSelections;
  }

  if (!minSelections && !maxSelections && !exactSelections) {
    return null;
  }

  return {
    minSelections: minSelections || undefined,
    maxSelections: maxSelections || undefined,
    exactSelections: exactSelections || undefined
  };
}

function parseInstructionNumber(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return 0;
}

function clampRuleNumber(value, optionsCount) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  const intValue = Math.floor(value);
  if (!optionsCount || optionsCount <= 0) {
    return intValue;
  }

  return Math.min(intValue, optionsCount);
}

function normalizeConstraintText(value) {
  let normalized = normalizeMatchValue(value);

  const numberWords = {
    one: "1",
    two: "2",
    three: "3",
    four: "4",
    five: "5",
    six: "6",
    seven: "7",
    eight: "8",
    nine: "9",
    ten: "10",
    один: "1",
    одна: "1",
    одну: "1",
    два: "2",
    две: "2",
    три: "3",
    четыре: "4",
    пять: "5",
    шесть: "6",
    семь: "7",
    восемь: "8",
    девять: "9",
    десять: "10"
  };

  for (const [word, digit] of Object.entries(numberWords)) {
    const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, "gi");
    normalized = normalized.replace(pattern, digit);
  }

  return normalized;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getOptions(item, type) {
  const selector = type === "single_choice" ? '[role="radio"]' : '[role="checkbox"]';
  const options = [];
  const seen = new Set();

  for (const optionElement of item.querySelectorAll(selector)) {
    const label = extractOptionLabel(optionElement);
    const normalized = normalizeMatchValue(label);

    if (!label || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    options.push(label);
  }

  return options;
}

function extractOptionLabel(optionElement) {
  const aria = optionElement.getAttribute("aria-label");
  if (aria) {
    return normalizeText(aria);
  }

  const siblingLabel = optionElement.parentElement?.querySelector("span");
  const siblingText = normalizeText(siblingLabel?.innerText || siblingLabel?.textContent || "");
  if (siblingText) {
    return siblingText;
  }

  const nearbyText = normalizeText(optionElement.parentElement?.innerText || optionElement.innerText || "");
  return nearbyText;
}

function isRequiredQuestion(item) {
  return Boolean(
    item.querySelector('[aria-label*="Required" i], [aria-label*="Обязательно" i]')
  );
}

function applyAnswers(questions, answers) {
  const answerMap = new Map();

  for (const answerItem of answers) {
    if (answerItem && typeof answerItem.id === "string") {
      answerMap.set(answerItem.id, answerItem.answer);
    }
  }

  let applied = 0;
  let unanswered = 0;

  for (const question of questions) {
    if (!answerMap.has(question.id)) {
      unanswered += 1;
      continue;
    }

    const answerValue = answerMap.get(question.id);
    const success = applyAnswerToQuestion(question, answerValue);

    if (success) {
      applied += 1;
    } else {
      unanswered += 1;
    }
  }

  return { applied, unanswered };
}

function applyAnswerToQuestion(question, answerValue) {
  if (question.type === "text") {
    return fillTextQuestion(question.element, answerValue);
  }

  if (question.type === "single_choice") {
    return fillSingleChoiceQuestion(question.element, answerValue);
  }

  if (question.type === "multiple_choice") {
    return fillMultipleChoiceQuestion(question, answerValue);
  }

  return false;
}

function fillTextQuestion(item, answerValue) {
  const targetInput = item.querySelector(
    'textarea, input[type="text"], input[type="email"], input[type="number"], input[type="url"]'
  );

  if (!targetInput) {
    return false;
  }

  const normalizedValue = Array.isArray(answerValue)
    ? answerValue.join(", ")
    : String(answerValue || "");

  setNativeValue(targetInput, normalizedValue);
  targetInput.dispatchEvent(new Event("input", { bubbles: true }));
  targetInput.dispatchEvent(new Event("change", { bubbles: true }));
  targetInput.dispatchEvent(new Event("blur", { bubbles: true }));

  return true;
}

function fillSingleChoiceQuestion(item, answerValue) {
  const optionElements = Array.from(item.querySelectorAll('[role="radio"]'));
  if (!optionElements.length) {
    return false;
  }

  const options = buildOptionEntries(optionElements);
  const desired = Array.isArray(answerValue)
    ? normalizeMatchValue(String(answerValue[0] || ""))
    : normalizeMatchValue(String(answerValue || ""));

  if (!desired) {
    return false;
  }

  const target = findBestOptionEntry(options, desired, new Set());
  if (!target) {
    return false;
  }

  if (target.element.getAttribute("aria-checked") !== "true") {
    target.element.click();
  }

  return true;
}

function fillMultipleChoiceQuestion(question, answerValue) {
  const optionElements = Array.from(question.element.querySelectorAll('[role="checkbox"]'));
  if (!optionElements.length) {
    return false;
  }

  const options = buildOptionEntries(optionElements);
  const wantedOptions = normalizeAnswerList(answerValue);
  if (!wantedOptions.length) {
    return false;
  }

  const usedIndices = new Set();
  const matchedOptions = [];

  for (const wanted of wantedOptions) {
    const target = findBestOptionEntry(options, wanted, usedIndices);
    if (!target) {
      continue;
    }

    usedIndices.add(target.index);
    matchedOptions.push(target);
  }

  const limitedOptions = applySelectionLimits(matchedOptions, question.selectionRules);
  const limitedIndexSet = new Set(limitedOptions.map((entry) => entry.index));

  for (const option of options) {
    const checked = option.element.getAttribute("aria-checked") === "true";
    const shouldBeChecked = limitedIndexSet.has(option.index);

    if (shouldBeChecked) {
      if (!checked) {
        option.element.click();
      }
    } else if (checked) {
      option.element.click();
    }
  }

  return limitedIndexSet.size > 0;
}

function applySelectionLimits(matchedOptions, selectionRules) {
  if (!Array.isArray(matchedOptions) || !matchedOptions.length) {
    return [];
  }

  const exactSelections = normalizeRuleNumber(selectionRules?.exactSelections);
  const maxSelections = normalizeRuleNumber(selectionRules?.maxSelections);

  if (exactSelections && matchedOptions.length > exactSelections) {
    return matchedOptions.slice(0, exactSelections);
  }

  if (maxSelections && matchedOptions.length > maxSelections) {
    return matchedOptions.slice(0, maxSelections);
  }

  return matchedOptions;
}

function normalizeRuleNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.floor(parsed);
}

function buildOptionEntries(optionElements) {
  const entries = [];

  for (let index = 0; index < optionElements.length; index += 1) {
    const element = optionElements[index];
    const label = extractOptionLabel(element);
    const normalized = normalizeMatchValue(label);

    if (!normalized) {
      continue;
    }

    entries.push({
      index,
      element,
      label,
      normalized
    });
  }

  return entries;
}

function findBestOptionEntry(options, desired, usedIndices) {
  if (!desired || !options.length) {
    return null;
  }

  let candidate = options.find(
    (option) => !usedIndices.has(option.index) && option.normalized === desired
  );

  if (candidate) {
    return candidate;
  }

  const shouldTrySubstring = desired.length >= 4;
  if (shouldTrySubstring) {
    candidate = options.find((option) => {
      if (usedIndices.has(option.index) || option.normalized.length < 4) {
        return false;
      }

      return option.normalized.includes(desired) || desired.includes(option.normalized);
    });

    if (candidate) {
      return candidate;
    }
  }

  let bestCandidate = null;
  let bestScore = 0;

  for (const option of options) {
    if (usedIndices.has(option.index)) {
      continue;
    }

    const score = scoreOptionMatch(option.normalized, desired);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = option;
    }
  }

  if (bestCandidate && bestScore >= 0.65) {
    return bestCandidate;
  }

  return null;
}

function scoreOptionMatch(optionText, desiredText) {
  if (!optionText || !desiredText) {
    return 0;
  }

  if (optionText === desiredText) {
    return 1;
  }

  if (optionText.length >= 4 && desiredText.length >= 4) {
    if (optionText.includes(desiredText) || desiredText.includes(optionText)) {
      return 0.8;
    }
  }

  const optionTokens = optionText.split(" ").filter((token) => token.length > 2);
  const desiredTokens = desiredText.split(" ").filter((token) => token.length > 2);

  if (!optionTokens.length || !desiredTokens.length) {
    return 0;
  }

  const optionSet = new Set(optionTokens);
  const desiredSet = new Set(desiredTokens);

  let intersection = 0;
  for (const token of desiredSet) {
    if (optionSet.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...optionSet, ...desiredSet]).size;
  if (!union) {
    return 0;
  }

  return intersection / union;
}

function normalizeAnswerList(answerValue) {
  let values = [];

  if (Array.isArray(answerValue)) {
    values = answerValue.map((entry) => String(entry));
  } else if (typeof answerValue === "string") {
    values = answerValue.split(/[,;\n]/);
  }

  return Array.from(
    new Set(
      values
        .map((entry) => normalizeMatchValue(entry))
        .filter(Boolean)
    )
  );
}

function setNativeValue(element, value) {
  const prototype = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

  if (descriptor?.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMatchValue(value) {
  return normalizeText(value).toLowerCase();
}

function isElementVisible(element) {
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }

  return element.getBoundingClientRect().height > 0;
}
