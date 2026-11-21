export interface PromptTemplate {
  id: string;
  label: string;
  promptSnippet: string;
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'cyberpunk-neon',
    label: 'Cyberpunk neon',
    promptSnippet:
      'cyberpunk neon aesthetic, rain-slicked futuristic streets, glowing magenta and cyan holographic reflections, volumetric night fog, anamorphic lens flare',
  },
  {
    id: '1970s-film-noir',
    label: '1970s film noir',
    promptSnippet:
      '1970s film noir cinematography, high-contrast chiaroscuro shadows, Venetian blind light shafts, gritty 35mm film grain, moody detective atmosphere',
  },
  {
    id: 'studio-ghibli-style',
    label: 'Studio Ghibli style',
    promptSnippet:
      'Studio Ghibli inspired hand-painted animation style, lush watercolor landscapes, drifting cumulus clouds, warm nostalgic sunlight, gentle expressive motion',
  },
  {
    id: 'epic-sci-fi',
    label: 'Epic sci-fi cinema',
    promptSnippet:
      'epic sci-fi blockbuster cinematography, colossal futuristic architecture, atmospheric haze, IMAX 70mm scale, dramatic rim lighting',
  },
  {
    id: 'vintage-35mm-kodak',
    label: '35mm Kodak vintage',
    promptSnippet:
      'vintage 35mm Kodak Vision3 film look, warm analog color palette, soft halation around highlights, subtle organic grain, nostalgic handheld framing',
  },
  {
    id: 'golden-hour-drama',
    label: 'Golden hour drama',
    promptSnippet:
      'golden hour cinematic drama, warm low-angle sunlight, backlit dust motes, rich amber skin tones, shallow optical depth of field',
  },
  {
    id: 'dark-fantasy',
    label: 'Dark fantasy gothic',
    promptSnippet:
      'dark fantasy gothic cinematography, mist-shrouded ancient stone ruins, flickering torchlight, deep emerald and charcoal shadows, epic atmospheric mood',
  },
  {
    id: 'documentary-realism',
    label: 'Documentary realism',
    promptSnippet:
      'authentic documentary realism, natural available light, unobtrusive handheld camera movement, candid unposed expressions, true-to-life textures',
  },
];

export function getPromptTemplateById(id: string): PromptTemplate | undefined {
  return PROMPT_TEMPLATES.find((template) => template.id === id);
}

/**
 * Appends the selected template snippet to the current prompt cleanly without duplicates.
 */
export function appendPromptTemplate(currentPrompt: string, templateId: string): string {
  const template = getPromptTemplateById(templateId);
  if (!template) return currentPrompt;

  const snippet = template.promptSnippet.trim();
  const base = currentPrompt.trim();
  if (!base) return snippet;

  if (base.toLowerCase().includes(snippet.toLowerCase())) {
    return currentPrompt;
  }

  const separator = /[.!?…,;:\n]$/.test(base) ? ' ' : ', ';
  return `${base}${separator}${snippet}`;
}
