import { describe, expect, it } from 'vitest';
import { classifyMessageIntent } from '../src/intentClassifier.js';

describe('intent classifier', () => {
  it('classifies goal requests', () => {
    expect(classifyMessageIntent({ content: '帮我做一个外卖 App 的 MVP 方案' })).toBe('goal');
  });

  it('classifies task requests', () => {
    expect(classifyMessageIntent({ content: 'Review 一下这个 PR' })).toBe('task');
  });

  it('classifies chat messages', () => {
    expect(classifyMessageIntent({ content: '今天天气不错' })).toBe('chat');
  });
});
