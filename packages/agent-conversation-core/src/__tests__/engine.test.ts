import { describe, expect, it } from 'vitest';
import { DefaultConversationEngine, InMemoryConversationStore, RecentNTurnsHistoryBuilder } from '..';

const store = new InMemoryConversationStore();
const engine = new DefaultConversationEngine({ store, historyBuilder: new RecentNTurnsHistoryBuilder({ maxTurns: 5 }) });

const fakeProvider = {
  async complete() {
    return {
      id: 'resp-1',
      createdAt: new Date(),
      message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    } as const;
  },
};

describe('DefaultConversationEngine', () => {
  it('runs a turn and stores messages', async () => {
    const result = await engine.runTurn({
      conversationId: 'c1',
      userMessages: [{ id: 'u1', role: 'user', createdAt: new Date(), content: [{ type: 'text', text: 'hello' }] }],
      provider: fakeProvider,
      providerParams: { model: 'gpt-test', messages: [] },
    });

    expect(result.assistantMessages[0].content[0].text).toBe('hi');
    const messages = await store.listMessages('c1');
    expect(messages.length).toBeGreaterThan(0);
  });
});

