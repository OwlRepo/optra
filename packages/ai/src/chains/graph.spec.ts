import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerQuestionWithGraph } from "./graph";

const {
  similaritySearchMock,
  selectMock,
  fromMock,
  whereMock,
  streamMock,
  invokeMock,
} = vi.hoisted(() => ({
  similaritySearchMock: vi.fn(),
  selectMock: vi.fn(),
  fromMock: vi.fn(),
  whereMock: vi.fn(),
  streamMock: vi.fn(),
  invokeMock: vi.fn(),
}));

vi.mock("../vectorstore", () => ({
  similaritySearch: similaritySearchMock,
  similaritySearchWithTicketSlot: similaritySearchMock,
}));

vi.mock("@repo/db", () => ({
  db: {
    select: selectMock,
  },
  documents: {
    id: "id",
    title: "title",
    sourceUrl: "sourceUrl",
    knowledgeBaseId: "knowledgeBaseId",
  },
  tickets: {
    id: "id",
    title: "title",
  },
}));

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: class {
    modelName: string;
    stream = streamMock;
    invoke = invokeMock;
    constructor(fields: { modelName: string }) {
      this.modelName = fields.modelName;
    }
  },
}));

describe("answerQuestionWithGraph", () => {
  const env = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...env,
      RETRIEVAL_SCORE_THRESHOLD: "0.35",
      MAX_QUERY_REWRITES: "2",
      SELF_GRADE_ENABLED: "false",
    };
    delete process.env.HISTORY_IN_ANSWER_ENABLED;

    selectMock.mockReturnValue({ from: fromMock });
    fromMock.mockReturnValue({ where: whereMock });
    whereMock.mockResolvedValue([
      { id: "doc-1", title: "Doc One", sourceUrl: "https://example.com/doc" },
    ]);
  });

  afterEach(() => {
    process.env = env;
  });

  it("high score goes straight to generate with one stream call and no rewrite", async () => {
    similaritySearchMock.mockResolvedValue([
      {
        id: "chunk-1",
        content: "Grounded context.",
        metadata: { documentId: "doc-1" },
        score: 0.91,
      },
    ]);
    streamMock.mockResolvedValue(
      (async function* () {
        yield { content: "answer" };
      })(),
    );

    const result = await answerQuestionWithGraph("question", "ws-1");
    const tokens: string[] = [];
    for await (const token of result.stream) {
      tokens.push(token);
    }

    expect(result.isFallback).toBe(false);
    expect(tokens).toEqual(["answer"]);
    expect(similaritySearchMock).toHaveBeenCalledTimes(1);
    expect(streamMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("uses hedged prompt copy while preserving hard no-info sentence", async () => {
    similaritySearchMock.mockResolvedValue([
      {
        id: "chunk-1",
        content: "Partial context.",
        metadata: { documentId: "doc-1" },
        score: 0.91,
      },
    ]);
    streamMock.mockResolvedValue(
      (async function* () {
        yield { content: "answer" };
      })(),
    );

    const result = await answerQuestionWithGraph("question", "ws-1");
    for await (const _token of result.stream) {
      // drain
    }

    const answerPrompt = streamMock.mock.calls[0][0][0].content;
    expect(answerPrompt).toContain("If the context is only partially relevant");
    expect(answerPrompt).toContain("point the user to the sources below");
    expect(answerPrompt).toContain(
      '"I don\'t have enough information to answer that."',
    );

    process.env.SELF_GRADE_ENABLED = "true";
    process.env.SELF_GRADE_MIN_SCORE = "1.0";
    streamMock.mockReset();
    invokeMock.mockReset();
    similaritySearchMock.mockResolvedValue([
      {
        id: "chunk-1",
        content: "Partial context.",
        metadata: { documentId: "doc-1" },
        score: 0.91,
      },
    ]);
    streamMock
      .mockResolvedValueOnce(
        (async function* () {
          yield { content: "first answer" };
        })(),
      )
      .mockResolvedValueOnce(
        (async function* () {
          yield { content: "regen answer" };
        })(),
      );
    invokeMock.mockResolvedValueOnce({ content: "no" });

    const regenerateResult = await answerQuestionWithGraph("question", "ws-1");
    for await (const _token of regenerateResult.stream) {
      // drain
    }

    const regeneratePrompt = streamMock.mock.calls[1][0][0].content;
    expect(regeneratePrompt).toContain("If any part is unsupported, omit it.");
    expect(regeneratePrompt).toContain(
      "If the context is only partially relevant, keep only the supported parts",
    );
    expect(regeneratePrompt).toContain(
      '"I don\'t have enough information to answer that."',
    );
  });

  it("low score rewrites once, retrieves again, then generates", async () => {
    similaritySearchMock
      .mockResolvedValueOnce([
        {
          id: "chunk-1",
          content: "Weak context.",
          metadata: { documentId: "doc-1" },
          score: 0.3,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "chunk-2",
          content: "Better context.",
          metadata: { documentId: "doc-1" },
          score: 0.88,
        },
      ]);
    invokeMock.mockResolvedValue({ content: "rewritten question" });
    streamMock.mockResolvedValue(
      (async function* () {
        yield { content: "better answer" };
      })(),
    );

    const result = await answerQuestionWithGraph("question", "ws-1");
    const tokens: string[] = [];
    for await (const token of result.stream) {
      tokens.push(token);
    }

    expect(tokens).toEqual(["better answer"]);
    expect(similaritySearchMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(streamMock).toHaveBeenCalledTimes(1);
  });

  it("falls back after max rewrites when retrieval stays low", async () => {
    similaritySearchMock.mockResolvedValue([
      {
        id: "chunk-1",
        content: "Weak context.",
        metadata: { documentId: "doc-1" },
        score: 0.2,
      },
    ]);
    invokeMock.mockResolvedValue({ content: "rewritten question" });

    const result = await answerQuestionWithGraph("question", "ws-1");
    const tokens: string[] = [];
    for await (const token of result.stream) {
      tokens.push(token);
    }

    expect(result.isFallback).toBe(true);
    expect(tokens).toEqual([
      "I don't have enough information to answer that. Consider escalating to a human.",
    ]);
    expect(result.sources).toEqual([]);
    expect(streamMock).not.toHaveBeenCalled();
  });

  it("keeps partial-context answers non-fallback and preserves sources", async () => {
    similaritySearchMock.mockResolvedValue([
      {
        id: "chunk-1",
        content: "Port 51212 appears in one service context.",
        metadata: { documentId: "doc-1" },
        score: 0.67,
      },
    ]);
    streamMock.mockResolvedValue(
      (async function* () {
        yield {
          content:
            "Found port 51212 in provided context, but exact REST API port is not stated.",
        };
      })(),
    );

    const result = await answerQuestionWithGraph("question", "ws-1");
    const tokens: string[] = [];
    for await (const token of result.stream) {
      tokens.push(token);
    }

    expect(result.isFallback).toBe(false);
    expect(tokens).toEqual([
      "Found port 51212 in provided context, but exact REST API port is not stated.",
    ]);
    expect(result.sources).toEqual([
      {
        sourceType: "document",
        documentId: "doc-1",
        knowledgeBaseId: undefined,
        title: "Doc One",
        sourceUrl: "https://example.com/doc",
        score: 0.67,
        snippet: "Port 51212 appears in one service context.",
      },
    ]);
  });

  it("self-grade can trigger one regenerate pass", async () => {
    process.env.SELF_GRADE_ENABLED = "true";
    similaritySearchMock.mockResolvedValue([
      {
        id: "chunk-1",
        content: "Grounded context.",
        metadata: { documentId: "doc-1" },
        score: 0.91,
      },
    ]);
    streamMock
      .mockResolvedValueOnce(
        (async function* () {
          yield { content: "first answer" };
        })(),
      )
      .mockResolvedValueOnce(
        (async function* () {
          yield { content: "regenerated answer" };
        })(),
      );
    invokeMock.mockResolvedValueOnce({ content: "no" });

    const result = await answerQuestionWithGraph("question", "ws-1");
    const tokens: string[] = [];
    for await (const token of result.stream) {
      tokens.push(token);
    }

    expect(tokens).toEqual(["regenerated answer"]);
    expect(streamMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("generates from the original question after a retrieval rewrite", async () => {
    process.env.SELF_GRADE_ENABLED = "false";
    similaritySearchMock
      .mockResolvedValueOnce([
        {
          id: "c1",
          content: "weak",
          metadata: { documentId: "doc-1" },
          score: 0.3,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "c2",
          content: "better",
          metadata: { documentId: "doc-1" },
          score: 0.9,
        },
      ]);
    invokeMock.mockResolvedValue({ content: "rewritten retrieval query" });
    streamMock.mockResolvedValue(
      (async function* () {
        yield { content: "answer" };
      })(),
    );

    const result = await answerQuestionWithGraph(
      "ORIGINAL user question",
      "ws-1",
    );
    for await (const _token of result.stream) {
      // drain
    }

    // Retrieval used the rewritten query on the second pass (re-embedded: no
    // precomputed vector after a rewrite).
    expect(similaritySearchMock).toHaveBeenNthCalledWith(
      2,
      "rewritten retrieval query",
      "ws-1",
      5,
      undefined,
      undefined,
    );
    // Generation used the ORIGINAL user question, not the rewritten retrieval query.
    const generateMessages = streamMock.mock.calls[0][0];
    const humanMessage = generateMessages[1];
    expect(humanMessage.content).toContain("ORIGINAL user question");
    expect(humanMessage.content).not.toContain("rewritten retrieval query");
  });

  it("confident path streams generation as multiple token chunks", async () => {
    process.env.SELF_GRADE_ENABLED = "false";
    similaritySearchMock.mockResolvedValue([
      {
        id: "chunk-1",
        content: "Grounded context.",
        metadata: { documentId: "doc-1" },
        score: 0.91,
      },
    ]);
    streamMock.mockResolvedValue(
      (async function* () {
        yield { content: "Hello " };
        yield { content: "world" };
      })(),
    );

    const result = await answerQuestionWithGraph("question", "ws-1");
    const tokens: string[] = [];
    for await (const token of result.stream) {
      tokens.push(token);
    }

    expect(tokens).toEqual(["Hello ", "world"]);
    expect(streamMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("self-grade skips grading when top score >= SELF_GRADE_MIN_SCORE", async () => {
    process.env.SELF_GRADE_ENABLED = "true";
    process.env.SELF_GRADE_MIN_SCORE = "0.35";
    similaritySearchMock.mockResolvedValue([
      {
        id: "chunk-1",
        content: "Grounded context.",
        metadata: { documentId: "doc-1" },
        score: 0.91,
      },
    ]);
    streamMock.mockResolvedValue(
      (async function* () {
        yield { content: "answer" };
      })(),
    );

    const result = await answerQuestionWithGraph("question", "ws-1");
    const tokens: string[] = [];
    for await (const token of result.stream) {
      tokens.push(token);
    }

    expect(tokens).toEqual(["answer"]);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(streamMock).toHaveBeenCalledTimes(1);
  });

  it("self-grade still grades when top score < SELF_GRADE_MIN_SCORE", async () => {
    process.env.SELF_GRADE_ENABLED = "true";
    process.env.SELF_GRADE_MIN_SCORE = "0.95";
    similaritySearchMock.mockResolvedValue([
      {
        id: "chunk-1",
        content: "Grounded context.",
        metadata: { documentId: "doc-1" },
        score: 0.91,
      },
    ]);
    streamMock
      .mockResolvedValueOnce(
        (async function* () {
          yield { content: "first answer" };
        })(),
      )
      .mockResolvedValueOnce(
        (async function* () {
          yield { content: "regenerated answer" };
        })(),
      );
    invokeMock.mockResolvedValueOnce({ content: "no" });

    const result = await answerQuestionWithGraph("question", "ws-1");
    const tokens: string[] = [];
    for await (const token of result.stream) {
      tokens.push(token);
    }

    expect(tokens).toEqual(["regenerated answer"]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(streamMock).toHaveBeenCalledTimes(2);
  });

  it("returns ticket citations from graph retrieval path", async () => {
    similaritySearchMock.mockResolvedValue([
      {
        id: "chunk-1",
        content: "Ticket context.",
        metadata: { ticketId: "ticket-1" },
        score: 0.91,
      },
    ]);
    whereMock.mockResolvedValueOnce([{ id: "ticket-1", title: "Ticket One" }]);
    streamMock.mockResolvedValue(
      (async function* () {
        yield { content: "answer" };
      })(),
    );

    const result = await answerQuestionWithGraph("question", "ws-1");

    expect(result.sources).toEqual([
      {
        sourceType: "ticket",
        ticketId: "ticket-1",
        title: "Ticket One",
        score: 0.91,
        snippet: "Ticket context.",
      },
    ]);
  });

  it("threads history into the confident-stream branch's prompt", async () => {
    similaritySearchMock.mockResolvedValue([
      {
        id: "chunk-1",
        content: "Grounded context.",
        metadata: { documentId: "doc-1" },
        score: 0.91,
      },
    ]);
    streamMock.mockResolvedValue(
      (async function* () {
        yield { content: "answer" };
      })(),
    );
    const history = [
      { role: "user" as const, content: "What is our refund policy?" },
      { role: "assistant" as const, content: "Refunds are available within 30 days." },
    ];

    const result = await answerQuestionWithGraph(
      "How do I request one?",
      "ws-1",
      5,
      undefined,
      undefined,
      history,
    );
    for await (const _token of result.stream) {
      // drain
    }

    const messages = streamMock.mock.calls[0][0];
    expect(messages).toHaveLength(4);
    expect(messages[1].content).toBe("What is our refund policy?");
    expect(messages[2].content).toBe("Refunds are available within 30 days.");
    expect(messages[3].content).toContain("How do I request one?");
  });

  it("threads history into the buffered generateNode prompt", async () => {
    process.env.SELF_GRADE_ENABLED = "true";
    similaritySearchMock.mockResolvedValue([
      {
        id: "chunk-1",
        content: "Grounded context.",
        metadata: { documentId: "doc-1" },
        score: 0.91,
      },
    ]);
    streamMock.mockResolvedValue(
      (async function* () {
        yield { content: "answer" };
      })(),
    );
    invokeMock.mockResolvedValue({ content: "yes" });
    const history = [
      { role: "user" as const, content: "What is our refund policy?" },
      { role: "assistant" as const, content: "Refunds are available within 30 days." },
    ];

    const result = await answerQuestionWithGraph(
      "How do I request one?",
      "ws-1",
      5,
      undefined,
      undefined,
      history,
    );
    for await (const _token of result.stream) {
      // drain
    }

    expect(streamMock).toHaveBeenCalledTimes(1);
    const messages = streamMock.mock.calls[0][0];
    expect(messages).toHaveLength(4);
    expect(messages[1].content).toBe("What is our refund policy?");
    expect(messages[2].content).toBe("Refunds are available within 30 days.");
    expect(messages[3].content).toContain("How do I request one?");
  });

  it("threads history into the regenerateNode's buffered prompt", async () => {
    process.env.SELF_GRADE_ENABLED = "true";
    similaritySearchMock.mockResolvedValue([
      {
        id: "chunk-1",
        content: "Grounded context.",
        metadata: { documentId: "doc-1" },
        score: 0.91,
      },
    ]);
    streamMock
      .mockResolvedValueOnce(
        (async function* () {
          yield { content: "first answer" };
        })(),
      )
      .mockResolvedValueOnce(
        (async function* () {
          yield { content: "regenerated answer" };
        })(),
      );
    invokeMock.mockResolvedValueOnce({ content: "no" });
    const history = [
      { role: "user" as const, content: "What is our refund policy?" },
      { role: "assistant" as const, content: "Refunds are available within 30 days." },
    ];

    const result = await answerQuestionWithGraph(
      "How do I request one?",
      "ws-1",
      5,
      undefined,
      undefined,
      history,
    );
    for await (const _token of result.stream) {
      // drain
    }

    expect(streamMock).toHaveBeenCalledTimes(2);
    const regenerateMessages = streamMock.mock.calls[1][0];
    expect(regenerateMessages).toHaveLength(4);
    expect(regenerateMessages[1].content).toBe("What is our refund policy?");
    expect(regenerateMessages[2].content).toBe("Refunds are available within 30 days.");
    expect(regenerateMessages[3].content).toContain("How do I request one?");
  });

  it("fallback path is unaffected by a non-empty history argument", async () => {
    similaritySearchMock.mockResolvedValue([
      {
        id: "chunk-1",
        content: "Weak context.",
        metadata: { documentId: "doc-1" },
        score: 0.2,
      },
    ]);
    invokeMock.mockResolvedValue({ content: "rewritten question" });
    const history = [{ role: "user" as const, content: "prior turn" }];

    const result = await answerQuestionWithGraph(
      "question",
      "ws-1",
      5,
      undefined,
      undefined,
      history,
    );
    const tokens: string[] = [];
    for await (const token of result.stream) {
      tokens.push(token);
    }

    expect(result.isFallback).toBe(true);
    expect(streamMock).not.toHaveBeenCalled();
  });

  describe("metering (S4)", () => {
    const CONFIDENT = [
      { id: "chunk-1", content: "Grounded context.", metadata: { documentId: "doc-1" }, score: 0.91 },
    ];

    beforeEach(() => {
      vi.resetModules();
      process.env.OPENAI_ANSWER_MODEL = "gpt-4o";
      process.env.OPENAI_REWRITE_MODEL = "gpt-4o-mini";
      process.env.OPENAI_GRADE_MODEL = "gpt-4o-mini";
    });

    afterEach(() => {
      delete process.env.OPENAI_ANSWER_MODEL;
      delete process.env.OPENAI_REWRITE_MODEL;
      delete process.env.OPENAI_GRADE_MODEL;
    });

    it("edge: the rewrite and grade calls record on the meter passed to answerQuestionWithGraph", async () => {
      process.env.SELF_GRADE_ENABLED = "true";
      similaritySearchMock
        .mockResolvedValueOnce([{ ...CONFIDENT[0], score: 0.3 }])
        .mockResolvedValueOnce(CONFIDENT);
      invokeMock
        .mockResolvedValueOnce({
          content: "rewritten question",
          usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        })
        .mockResolvedValueOnce({
          content: "yes",
          usage_metadata: { input_tokens: 20, output_tokens: 1, total_tokens: 21 },
        });
      streamMock.mockResolvedValue(
        (async function* () {
          yield { content: "answer" };
          yield { content: "", usage_metadata: { input_tokens: 100, output_tokens: 40, total_tokens: 140 } };
        })(),
      );

      const { answerQuestionWithGraph } = await import("./graph");
      const { TokenMeter } = await import("../tokens");
      const meter = new TokenMeter();
      const result = await answerQuestionWithGraph("question", "ws-1", 5, undefined, undefined, [], meter);
      for await (const _token of result.stream) {
        // drain
      }

      // rewrite 15 + answer 140 + grade 21.
      expect(meter.total).toBe(176);
      expect(meter.inputTokens).toBe(130);
      expect(meter.outputTokens).toBe(46);
      // gpt-4o 100/40 = 650; gpt-4o-mini 30 in / 6 out = ceil(8.1) = 9.
      expect(meter.costMicroUsd).toBe(659);
      expect(meter.dominantModel).toBe("gpt-4o");
    });

    it("edge: only the trailing stream chunk's usage is counted on the confident streaming path", async () => {
      similaritySearchMock.mockResolvedValue(CONFIDENT);
      streamMock.mockResolvedValue(
        (async function* () {
          yield { content: "a" };
          yield { content: "b" };
          yield { content: "", usage_metadata: { input_tokens: 50, output_tokens: 20, total_tokens: 70 } };
        })(),
      );

      const { answerQuestionWithGraph } = await import("./graph");
      const { TokenMeter } = await import("../tokens");
      const meter = new TokenMeter();
      const result = await answerQuestionWithGraph("question", "ws-1", 5, undefined, undefined, [], meter);
      const tokens: string[] = [];
      for await (const token of result.stream) {
        tokens.push(token);
      }

      expect(tokens).toEqual(["a", "b"]);
      expect(meter.total).toBe(70);
      expect(meter.inputTokens).toBe(50);
      expect(meter.dominantModel).toBe("gpt-4o");
    });

    it("regression: answerQuestionWithGraph without a meter behaves as before", async () => {
      similaritySearchMock.mockResolvedValue(CONFIDENT);
      streamMock.mockResolvedValue(
        (async function* () {
          yield { content: "plain" };
          yield { content: "", usage_metadata: { input_tokens: 5, output_tokens: 5, total_tokens: 10 } };
        })(),
      );

      const { answerQuestionWithGraph } = await import("./graph");
      const result = await answerQuestionWithGraph("question", "ws-1");
      const tokens: string[] = [];
      for await (const token of result.stream) {
        tokens.push(token);
      }

      expect(result.isFallback).toBe(false);
      expect(tokens).toEqual(["plain"]);
    });

    it("happy: the buffered generate path records the answer stream's usage on the meter", async () => {
      process.env.SELF_GRADE_ENABLED = "true";
      similaritySearchMock.mockResolvedValue(CONFIDENT);
      streamMock.mockResolvedValue(
        (async function* () {
          yield { content: "buffered answer" };
          yield { content: "", usage_metadata: { input_tokens: 100, output_tokens: 40, total_tokens: 140 } };
        })(),
      );
      invokeMock.mockResolvedValueOnce({ content: "yes" });

      const { answerQuestionWithGraph } = await import("./graph");
      const { TokenMeter } = await import("../tokens");
      const meter = new TokenMeter();
      const result = await answerQuestionWithGraph("question", "ws-1", 5, undefined, undefined, [], meter);
      const tokens: string[] = [];
      for await (const token of result.stream) {
        tokens.push(token);
      }

      expect(tokens).toEqual(["buffered answer"]);
      expect(meter.total).toBe(140);
      expect(meter.inputTokens).toBe(100);
      expect(meter.outputTokens).toBe(40);
    });
  });
});
