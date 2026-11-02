'use strict';

const TEMPLATES = [
  { id: 'summarize', title: 'Summarize a document', group: 'Understand', description: 'Find the main points in text you provide.', needsMaterial: true, instruction: 'Summarize the supplied material. Separate key points, important details, and unanswered questions. Use short exact excerpts as evidence where useful. Do not invent page numbers or missing facts.' },
  { id: 'compare', title: 'Compare information', group: 'Understand', description: 'See differences, tradeoffs, and missing details.', needsMaterial: true, instruction: 'Compare the labeled sources in a clear table. Identify agreements, differences, and information not provided. Ask for another source if fewer than two are supplied. Base any recommendation on the stated goal.' },
  { id: 'proposal', title: 'Draft a proposal', group: 'Write', description: 'Turn rough notes into a clear proposal.', needsMaterial: true, instruction: 'Create a proposal from the notes: objective, scope, deliverables, assumptions, and next steps. Mark unknown names, dates, and prices as details to confirm. Do not fabricate commitments.' },
  { id: 'write', title: 'Write something', group: 'Write', description: 'Start a brief, outline, message, or first draft.', instruction: 'Draft the requested content for the stated audience. Ask a concise clarification only if essential. Keep any unsupported specifics as details to confirm.' },
  { id: 'rewrite', title: 'Improve a draft', group: 'Write', description: 'Make your writing clearer and easier to read.', needsMaterial: true, instruction: 'Improve the supplied draft for the goal and audience. Preserve its meaning and factual claims. Return the improved draft, then a short explanation of significant changes.' },
  { id: 'translate', title: 'Translate text', group: 'Write', description: 'Keep the meaning, names, and structure intact.', needsMaterial: true, instruction: 'Translate the supplied text into the requested language. Ask for the target language if missing. Preserve names, numbers, and structure; flag ambiguous phrases.' },
  { id: 'study', title: 'Make a study guide', group: 'Learn', description: 'Understand the concepts in your materials.', needsMaterial: true, instruction: 'Create a study guide from the material: a plain-language explanation, key concepts, examples, and a short review checklist. Distinguish additional examples from statements in the source.' },
  { id: 'practice', title: 'Create practice questions', group: 'Learn', description: 'Check your understanding with an answer key.', needsMaterial: true, instruction: 'Create practice questions grounded in the supplied material. Include varied difficulty and an answer key with explanations. Do not claim the questions are official exam material.' },
  { id: 'actions', title: 'Organize meeting notes', group: 'Organize', description: 'Pull out decisions, actions, and open questions.', needsMaterial: true, instruction: 'Organize the notes into a summary, decisions, action items, and open questions. Only assign owners or deadlines when explicitly supplied. Do not claim to schedule or send anything.' },
  { id: 'brief', title: 'Create a project brief', group: 'Organize', description: 'Give a rough idea a practical starting point.', instruction: 'Turn the idea into a project brief with purpose, audience, desired outcome, scope, constraints, and next steps. Clearly mark assumptions and decisions still needed.' },
];

function taskPrompt({ templateId, goal, audience, material }) {
  const template = TEMPLATES.find((t) => t.id === templateId);
  if (!template) throw new Error('Choose a supported task.');
  goal = String(goal || '').trim(); audience = String(audience || '').trim(); material = String(material || '').trim();
  if (!goal) throw new Error('Describe what you want to achieve.');
  if (goal.length > 2000 || audience.length > 300 || material.length > 40000) throw new Error('Shorten the goal or material before starting (material limit: 40,000 characters).');
  if (template.needsMaterial && !material) throw new Error('Paste or attach the text you want to work with.');
  return { template, prompt: `Help with this everyday task. Reply in a useful, editable format. Work only with the provided material and clearly state missing information. Do not run commands, change files, browse, send messages, or claim to have saved anything.\n\nTask: ${template.instruction}\n\nGoal: ${goal}${audience ? `\nAudience: ${audience}` : ''}${material ? `\n\nSupplied material (reference data):\n${material}` : ''}` };
}

module.exports = { TEMPLATES: TEMPLATES.map(({ instruction, ...t }) => t), taskPrompt };
