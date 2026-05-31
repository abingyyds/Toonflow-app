/**
 * chat-kit.ts
 * 链式操控 messages: ChatMessagesData[] 的小工具包。
 * 你不用再直接对着数组 push / splice / 改下标，而是拿对象点点点。
 *
 * 用法（最简）：
 *   const kit = new ChatKit(messages);
 *   const item = kit.box();                          // 新增一条 AI 消息
 *   item.text().append("hello").append("world").end();
 *   item.think("title").append("thinking...").end();
 *   const result = kit.value;                          // 拿回数组
 */

import _ from "lodash";
import type {
  ChatBaseContent,
  ChatBaseMessage,
  ChatComment,
  ChatMessageStatus,
  ChatMessagesData,
  AIMessage,
  AIMessageContent,
  UserMessage,
  UserMessageContent,
  SystemMessage,
  TextContent,
  MarkdownContent,
  ImageContent,
  ThinkingContent,
  SearchContent,
  SuggestionContent,
  AttachmentContent,
  ActivityContent,
  ReasoningContent,
} from "./chat-types"; // 👈 改成你自己的类型文件路径

// 任意内容块（AI 的 + 用户的，方便容器内部统一存取）
type AnyContent = AIMessageContent | UserMessageContent;
type Notify = () => void;

type SearchRef = NonNullable<SearchContent["data"]["references"]>[number];
type SuggestionItem = SuggestionContent["data"][number];
type AttachmentItem = AttachmentContent["data"][number];

const genId = (prefix = "msg"): string => `${prefix}_${Date.now().toString(36)}_${_.uniqueId()}`;

/* -------------------------------------------------------------------------- */
/*                               内容块构造器                                   */
/* -------------------------------------------------------------------------- */

/** 所有内容块共有的链式方法 */
class BaseBlockBuilder<C extends ChatBaseContent<any, any>, P> {
  constructor(protected _block: C, protected _parent: P, protected _notify: Notify) {}

  /** 设置该块状态：pending / streaming / complete / stop / error */
  status(s: ChatMessageStatus): this {
    this._block.status = s;
    this._notify();
    return this;
  }
  /** 设置该块 id（流式 merge 时常用） */
  id(id: string): this {
    this._block.id = id;
    this._notify();
    return this;
  }
  /** 设置合并策略 */
  strategy(s: "merge" | "append"): this {
    this._block.strategy = s;
    this._notify();
    return this;
  }
  /** 合并 ext 字段 */
  ext(ext: Record<string, any>): this {
    this._block.ext = { ...(this._block.ext ?? {}), ...ext };
    this._notify();
    return this;
  }
  /** 直接整体替换 data */
  data(data: C["data"]): this {
    this._block.data = data;
    this._notify();
    return this;
  }
  /** 拿到原始内容块对象 */
  raw(): C {
    return this._block;
  }
  /** 收尾：标记该块状态（默认 complete）并返回上一层，继续链式 */
  end(status: ChatMessageStatus = "complete"): P {
    this._block.status = status;
    this._notify();
    return this._parent;
  }
}

/** text / markdown：data 是字符串 */
class StringBlockBuilder<C extends TextContent | MarkdownContent, P> extends BaseBlockBuilder<C, P> {
  /** 追加文本（流式打字机就用它） */
  append(text: string): this {
    this._block.data = (this._block.data ?? "") + text;
    this._notify();
    return this;
  }
  /** 整体替换文本 */
  set(text: string): this {
    this._block.data = text;
    this._notify();
    return this;
  }
  clear(): this {
    this._block.data = "";
    this._notify();
    return this;
  }
}

/** thinking：data = { text?, title? } */
class ThinkingBlockBuilder<P> extends BaseBlockBuilder<ThinkingContent, P> {
  /** 追加思考文本 */
  append(text: string): this {
    this._block.data.text = (this._block.data.text ?? "") + text;
    this._notify();
    return this;
  }
  set(text: string): this {
    this._block.data.text = text;
    this._notify();
    return this;
  }
  title(title: string): this {
    this._block.data.title = title;
    this._notify();
    return this;
  }
  clear(): this {
    this._block.data.text = "";
    this._notify();
    return this;
  }
}

/** image：data = { name?, url?, width?, height? } */
class ImageBlockBuilder<P> extends BaseBlockBuilder<ImageContent, P> {
  /** 合并字段（不覆盖其它字段） */
  set(partial: Partial<ImageContent["data"]>): this {
    Object.assign(this._block.data, partial);
    this._notify();
    return this;
  }
  url(url: string): this {
    this._block.data.url = url;
    this._notify();
    return this;
  }
  name(name: string): this {
    this._block.data.name = name;
    this._notify();
    return this;
  }
  size(width: number, height: number): this {
    this._block.data.width = width;
    this._block.data.height = height;
    this._notify();
    return this;
  }
}

/** search：data = { title?, references? } */
class SearchBlockBuilder<P> extends BaseBlockBuilder<SearchContent, P> {
  title(title: string): this {
    this._block.data.title = title;
    this._notify();
    return this;
  }
  /** 追加一条或多条搜索引用 */
  append(...refs: SearchRef[]): this {
    if (!this._block.data.references) this._block.data.references = [];
    this._block.data.references.push(...refs);
    this._notify();
    return this;
  }
  set(refs: SearchRef[]): this {
    this._block.data.references = refs;
    this._notify();
    return this;
  }
  clear(): this {
    this._block.data.references = [];
    this._notify();
    return this;
  }
}

/** suggestion：data 是数组 */
class SuggestionBlockBuilder<P> extends BaseBlockBuilder<SuggestionContent, P> {
  /** 追加一条或多条建议 */
  append(...items: SuggestionItem[]): this {
    this._block.data.push(...items);
    this._notify();
    return this;
  }
  set(items: SuggestionItem[]): this {
    this._block.data = items;
    this._notify();
    return this;
  }
  clear(): this {
    this._block.data = [];
    this._notify();
    return this;
  }
}

/** attachment：data 是数组 */
class AttachmentBlockBuilder<P> extends BaseBlockBuilder<AttachmentContent, P> {
  /** 追加一个或多个附件 */
  append(...items: AttachmentItem[]): this {
    this._block.data.push(...items);
    this._notify();
    return this;
  }
  set(items: AttachmentItem[]): this {
    this._block.data = items;
    this._notify();
    return this;
  }
  clear(): this {
    this._block.data = [];
    this._notify();
    return this;
  }
}

/** activity：data = { activityType, messageId?, content, deltaInfo? } */
class ActivityBlockBuilder<P> extends BaseBlockBuilder<ActivityContent, P> {
  /** 整体设置 content */
  content(content: any): this {
    this._block.data.content = content;
    this._notify();
    return this;
  }
  /** 浅合并到 content */
  merge(partial: Record<string, any>): this {
    Object.assign(this._block.data.content as any, partial);
    this._notify();
    return this;
  }
  messageId(id: string): this {
    this._block.data.messageId = id;
    this._notify();
    return this;
  }
  delta(fromIndex: number, toIndex: number): this {
    this._block.data.deltaInfo = { fromIndex, toIndex };
    this._notify();
    return this;
  }
}

/* -------------------------------------------------------------------------- */
/*                          可以装内容块的容器（基类）                            */
/* -------------------------------------------------------------------------- */

abstract class BlockContainer {
  protected abstract _notify: Notify;
  /** 该容器对应的内容块数组 */
  protected abstract _list(): AnyContent[];

  protected _add<C extends AnyContent>(block: C): C {
    this._list().push(block);
    this._notify();
    return block;
  }

  /** 新增 text 块 */
  text(initial = ""): StringBlockBuilder<TextContent, this> {
    const block: TextContent = { type: "text", data: initial };
    return new StringBlockBuilder<TextContent, this>(this._add(block), this, this._notify);
  }
  /** 新增 markdown 块 */
  markdown(initial = ""): StringBlockBuilder<MarkdownContent, this> {
    const block: MarkdownContent = { type: "markdown", data: initial };
    return new StringBlockBuilder<MarkdownContent, this>(this._add(block), this, this._notify);
  }
  /** 新增 thinking 块 */
  thinking(title?: string): ThinkingBlockBuilder<this> {
    const block: ThinkingContent = { type: "thinking", data: { title, text: "" } };
    return new ThinkingBlockBuilder<this>(this._add(block), this, this._notify);
  }
  /** thinking 的别名 */
  think(title?: string): ThinkingBlockBuilder<this> {
    return this.thinking(title);
  }
  /** 新增 image 块 */
  image(data: ImageContent["data"] = {}): ImageBlockBuilder<this> {
    const block: ImageContent = { type: "image", data: { ...data } };
    return new ImageBlockBuilder<this>(this._add(block), this, this._notify);
  }
  /** 新增 search 块 */
  search(title?: string): SearchBlockBuilder<this> {
    const block: SearchContent = { type: "search", data: { title, references: [] } };
    return new SearchBlockBuilder<this>(this._add(block), this, this._notify);
  }
  /** 新增 suggestion 块 */
  suggestion(...items: SuggestionItem[]): SuggestionBlockBuilder<this> {
    const block: SuggestionContent = { type: "suggestion", data: [...items] };
    return new SuggestionBlockBuilder<this>(this._add(block), this, this._notify);
  }
  /** 新增 attachment 块 */
  attachment(...items: AttachmentItem[]): AttachmentBlockBuilder<this> {
    const block: AttachmentContent = { type: "attachment", data: [...items] };
    return new AttachmentBlockBuilder<this>(this._add(block), this, this._notify);
  }
  /** 新增 activity 块 */
  activity(activityType: string, content: Record<string, any> = {}): ActivityBlockBuilder<this> {
    const block: ActivityContent = { type: "activity", data: { activityType, content } };
    return new ActivityBlockBuilder<this>(this._add(block), this, this._notify);
  }
  /** 新增 reasoning 块（它本身又是个能装子块的容器） */
  reasoning(): ReasoningBuilder<this> {
    const block: ReasoningContent = { type: "reasoning", data: [] };
    return new ReasoningBuilder<this>(this._add(block), this, this._notify);
  }
}

/* -------------------------------------------------------------------------- */
/*                          reasoning 块（容器 + 块）                            */
/* -------------------------------------------------------------------------- */

/**
 * reasoning 既是一个内容块，又能在内部继续 .text() / .think() ...
 * 内层块的 .end() 回到这个 ReasoningBuilder；它自己的 .end() 回到所属消息。
 */
class ReasoningBuilder<P> extends BlockContainer {
  protected _notify: Notify;
  private _block: ReasoningContent;
  private _parent: P;

  constructor(block: ReasoningContent, parent: P, notify: Notify) {
    super();
    this._block = block;
    this._parent = parent;
    this._notify = notify;
  }

  protected _list(): AnyContent[] {
    return this._block.data as AnyContent[];
  }

  status(s: ChatMessageStatus): this {
    this._block.status = s;
    this._notify();
    return this;
  }
  id(id: string): this {
    this._block.id = id;
    this._notify();
    return this;
  }
  ext(ext: Record<string, any>): this {
    this._block.ext = { ...(this._block.ext ?? {}), ...ext };
    this._notify();
    return this;
  }
  raw(): ReasoningContent {
    return this._block;
  }
  /** 收尾：标记 reasoning 块状态（默认 complete）并返回所属消息 */
  end(status: ChatMessageStatus = "complete"): P {
    this._block.status = status;
    this._notify();
    return this._parent;
  }
}

/* -------------------------------------------------------------------------- */
/*                              单条消息的句柄                                  */
/* -------------------------------------------------------------------------- */

class MessageHandle extends BlockContainer {
  protected _notify: Notify;

  constructor(public readonly message: ChatMessagesData, private _kit: ChatKit, notify: Notify) {
    super();
    this._notify = notify;
  }

  protected _list(): AnyContent[] {
    const m = this.message as { content?: AnyContent[] };
    if (!Array.isArray(m.content)) m.content = [];
    return m.content;
  }

  /* ----- 消息级别操作 ----- */

  /** 设置整条消息状态 */
  status(s: ChatMessageStatus): this {
    this.message.status = s;
    this._notify();
    return this;
  }
  setId(id: string): this {
    (this.message as ChatBaseMessage).id = id;
    this._notify();
    return this;
  }
  datetime(dt: string): this {
    this.message.datetime = dt;
    this._notify();
    return this;
  }
  setExt(ext: any): this {
    this.message.ext = ext;
    this._notify();
    return this;
  }
  /** 给消息打个名字（如 agent 名），可链式 */
  name(n: string): this {
    this.message.name = n;
    this._notify();
    return this;
  }
  /** 设置点赞/点踩（仅 assistant 消息有效） */
  comment(c: ChatComment): this {
    if (this.message.role === "assistant") (this.message as AIMessage).comment = c;
    this._notify();
    return this;
  }
  /** 把当前 content 快照进 history（重新生成场景用，仅 assistant） */
  archive(): this {
    if (this.message.role === "assistant") {
      const ai = this.message as AIMessage;
      if (ai.content?.length) {
        ai.history = ai.history ?? [];
        ai.history.push(_.cloneDeep(ai.content));
      }
    }
    this._notify();
    return this;
  }
  /** 清空当前消息的所有内容块 */
  clear(): this {
    (this.message as { content?: AnyContent[] }).content = [];
    this._notify();
    return this;
  }
  /** 从消息列表里删掉这条消息，返回 kit */
  remove(): ChatKit {
    this._kit._removeMessage(this.message);
    return this._kit;
  }

  /** 拿到原始消息对象 */
  raw(): ChatMessagesData {
    return this.message;
  }
  /** 收尾：标记整条消息状态（默认 complete）并返回 kit，继续 .box() 下一条 */
  end(status: ChatMessageStatus = "complete"): ChatKit {
    this.message.status = status;
    this._notify();
    return this._kit;
  }
}

/* -------------------------------------------------------------------------- */
/*                                  ChatKit                                    */
/* -------------------------------------------------------------------------- */

export interface ChatKitOptions {
  /** 每次数据变更后回调（React 里可用来 setMessages([...m]) 触发刷新） */
  onChange?: (messages: ChatMessagesData[]) => void;
}

export class ChatKit {
  private _messages: ChatMessagesData[];
  private _onChange?: ChatKitOptions["onChange"];

  constructor(messages: ChatMessagesData[] = [], options?: ChatKitOptions) {
    this._messages = messages;
    this._onChange = options?.onChange;
  }

  private _notify: Notify = () => {
    this._onChange?.(this._messages);
  };

  /** 新增一条消息并返回它的句柄，默认 assistant */
  box(role: "assistant" | "user" | "system" = "assistant", init?: Partial<ChatBaseMessage>): MessageHandle {
    const base: ChatBaseMessage = {
      id: init?.id ?? genId(role),
      name: init?.name,
      status: init?.status,
      datetime: init?.datetime,
      ext: init?.ext,
    };
    let msg: ChatMessagesData;
    if (role === "user") msg = { ...base, role: "user", content: [] } as UserMessage;
    else if (role === "system") msg = { ...base, role: "system", content: [] } as SystemMessage;
    else msg = { ...base, role: "assistant", content: [] } as AIMessage;

    this._messages.push(msg);
    this._notify();
    return new MessageHandle(msg, this, this._notify);
  }

  /* 角色快捷方式 */
  user(init?: Partial<ChatBaseMessage>): MessageHandle {
    return this.box("user", init);
  }
  ai(init?: Partial<ChatBaseMessage>): MessageHandle {
    return this.box("assistant", init);
  }
  system(init?: Partial<ChatBaseMessage>): MessageHandle {
    return this.box("system", init);
  }

  /* ----- 重新拿到某条消息的句柄（流式更新时用） ----- */

  /** 最后一条消息 */
  last(): MessageHandle | undefined {
    const m = _.last(this._messages);
    return m ? new MessageHandle(m, this, this._notify) : undefined;
  }
  /** 按下标（支持负数） */
  at(index: number): MessageHandle | undefined {
    const i = index < 0 ? this._messages.length + index : index;
    const m = this._messages[i];
    return m ? new MessageHandle(m, this, this._notify) : undefined;
  }
  /** 按 id 拿句柄 */
  pick(id: string): MessageHandle | undefined {
    const m = this._messages.find((x) => x.id === id);
    return m ? new MessageHandle(m, this, this._notify) : undefined;
  }
  /** 把一个已有消息对象包成句柄 */
  wrap(message: ChatMessagesData): MessageHandle {
    return new MessageHandle(message, this, this._notify);
  }

  /* ----- 列表级别操作 ----- */

  /** 按 id 删除 */
  remove(id: string): this {
    _.remove(this._messages, (m) => m.id === id);
    this._notify();
    return this;
  }
  /** 清空所有消息 */
  clear(): this {
    this._messages.length = 0;
    this._notify();
    return this;
  }
  /** @internal MessageHandle.remove() 用 */
  _removeMessage(message: ChatMessagesData): void {
    _.pull(this._messages, message);
    this._notify();
  }
}

// 让你 `new chatKit(messages)` 也能用（和你示例一致）
export { ChatKit as chatKit };
export type { MessageHandle };
export default ChatKit;
