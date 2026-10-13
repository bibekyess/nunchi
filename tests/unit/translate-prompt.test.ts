import { describe, expect, it } from 'vitest';
import { buildTranslateMessages } from '@/lib/prompts/translate';

describe('buildTranslateMessages', () => {
  const base = {
    text: '키로 팀은 시애틀에 있습니다.',
    sourceLang: 'ko' as const,
    targetLang: 'en' as const,
    context: [],
    glossary: [],
  };

  it('names the languages and marks an empty glossary and context', () => {
    const [system, user] = buildTranslateMessages(base);
    expect(system.role).toBe('system');
    expect(system.content).toContain('from Korean to English');
    expect(system.content).toContain('(none)');
    expect(user.content).toContain('(start of meeting)');
    expect(user.content.endsWith('CURRENT line:\n키로 팀은 시애틀에 있습니다.')).toBe(true);
  });

  it('includes glossary, context and meeting context', () => {
    const [system, user] = buildTranslateMessages({
      ...base,
      glossary: [{ term: '키로', translation: 'Kiro' }, { term: 'AI Tinkerers' }, { term: '  ' }],
      context: [{ source: '안녕하세요.', translation: 'Hello.' }],
      meetingContext: 'AI Tinkerers Seoul meetup',
    });
    expect(system.content.startsWith('Meeting context: AI Tinkerers Seoul meetup')).toBe(true);
    expect(system.content).toContain('키로 → Kiro\nAI Tinkerers');
    expect(system.content).not.toContain('(none)');
    expect(user.content).toContain('- 안녕하세요. => Hello.');
  });

  it('starts with the interpreter line when there is no meeting context', () => {
    const [system] = buildTranslateMessages(base);
    expect(system.content.startsWith('You are a live interpreter')).toBe(true);
  });
});
