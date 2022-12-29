import { escapeHtml } from "./utils.js";

import type { Options, PluginWithOptions } from "markdown-it";
import type Renderer from "markdown-it/lib/renderer.js";
import type Token from "markdown-it/lib/token.js";
import type { RuleBlock } from "markdown-it/lib/parser_block.js";
import type {
  MarkdownItTabOptions,
  MarkdownItTabData,
  MarkdownItTabInfo,
} from "./options";

const TAB_MARKER = `@tab`;

const getTabRule =
  (name: string): RuleBlock =>
  (state, startLine, endLine, silent) => {
    let start = state.bMarks[startLine] + state.tShift[startLine];
    let max = state.eMarks[startLine];

    /*
     * Check out the first character quickly,
     * this should filter out most of non-uml blocks
     */
    if (state.src.charAt(start) !== "@") return false;

    let index;

    // Check out the rest of the marker string
    for (index = 0; index < TAB_MARKER.length; index++)
      if (TAB_MARKER[index] !== state.src[start + index]) return false;

    const markup = state.src.slice(start, start + index);
    const info = state.src.slice(start + index, max);

    // Since start is found, we can report success here in validation mode
    if (silent) return true;

    let nextLine = startLine;
    let autoClosed = false;

    // Search for the end of the block
    while (
      // unclosed block should be auto closed by end of document.
      // also block seems to be auto closed by end of parent
      nextLine < endLine
    ) {
      nextLine += 1;
      start = state.bMarks[nextLine] + state.tShift[nextLine];
      max = state.eMarks[nextLine];

      if (start < max && state.sCount[nextLine] < state.blkIndent)
        // non-empty line with negative indent should stop the list:
        // - ```
        //  test
        break;

      if (
        // match start
        state.src[start] === "@" &&
        // marker should not be indented with respect of opening fence
        state.sCount[nextLine] <= state.sCount[startLine]
      ) {
        let openMakerMatched = true;

        for (index = 0; index < TAB_MARKER.length; index++)
          if (TAB_MARKER[index] !== state.src[start + index]) {
            openMakerMatched = false;
            break;
          }

        if (openMakerMatched) {
          // found!
          autoClosed = true;
          nextLine -= 1;
          break;
        }
      }
    }

    const oldParent = state.parentType;
    const oldLineMax = state.lineMax;

    // @ts-expect-error
    state.parentType = `tab`;

    // this will prevent lazy continuations from ever going past our end marker
    state.lineMax = nextLine;

    const openToken = state.push(`${name}_tab_open`, "", 1);

    const [title, id] = info.replace(/^:active/, "").split("#", 2);

    openToken.block = true;
    openToken.markup = markup;
    openToken.info = title.trim();
    openToken.meta = {
      active: info.includes(":active"),
    };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (id) openToken.meta.id = id.trim();
    openToken.map = [startLine, nextLine];

    state.md.block.tokenize(state, startLine + 1, nextLine);

    const closeToken = state.push(`${name}_tab_close`, "", -1);

    closeToken.block = true;
    closeToken.markup = "";

    state.parentType = oldParent;
    state.lineMax = oldLineMax;
    state.line = nextLine + (autoClosed ? 1 : 0);

    return true;
  };

const getTabsRule =
  (name: string): RuleBlock =>
  (state, startLine, endLine, silent) => {
    let start = state.bMarks[startLine] + state.tShift[startLine];
    let max = state.eMarks[startLine];

    // Check out the first character quickly,
    // this should filter out most of non-containers
    if (state.src[start] !== ":") return false;

    let pos = start + 1;

    // Check out the rest of the marker string
    while (pos <= max) {
      if (state.src[pos] !== ":") break;
      pos += 1;
    }

    const markerCount = pos - start;

    if (markerCount < 3) return false;

    const markup = state.src.slice(start, pos);
    const params = state.src.slice(pos, max);

    const [containerName, id = ""] = params.split("#", 2);

    if (containerName.trim() !== name) return false;

    // Since start is found, we can report success here in validation mode
    if (silent) return true;

    // Search for the end of the block
    let nextLine = startLine;
    let autoClosed = false;

    // Search for the end of the block
    while (
      // unclosed block should be auto closed by end of document.
      // also block seems to be auto closed by end of parent
      nextLine < endLine
    ) {
      nextLine += 1;
      start = state.bMarks[nextLine] + state.tShift[nextLine];
      max = state.eMarks[nextLine];

      if (start < max && state.sCount[nextLine] < state.blkIndent)
        // non-empty line with negative indent should stop the list:
        // - ```
        //  test
        break;

      if (
        // match start

        state.src[start] === ":" &&
        // closing fence should be indented less than 4 spaces
        state.sCount[nextLine] - state.blkIndent < 4
      ) {
        // check rest of marker
        for (pos = start + 1; pos <= max; pos++)
          if (state.src[pos] !== ":") break;

        // closing code fence must be at least as long as the opening one
        if (pos - start >= markerCount) {
          // make sure tail has spaces only
          pos = state.skipSpaces(pos);

          if (pos >= max) {
            // found!
            autoClosed = true;
            break;
          }
        }
      }
    }

    const oldParent = state.parentType;
    const oldLineMax = state.lineMax;

    // @ts-expect-error
    state.parentType = `${name}_tabs`;

    // this will prevent lazy continuations from ever going past our end marker
    state.lineMax = nextLine - (autoClosed ? 1 : 0);

    const openToken = state.push(`${name}_tabs_open`, "", 1);

    openToken.markup = markup;
    openToken.block = true;
    openToken.info = containerName;
    openToken.meta = { id: id.trim() };
    openToken.map = [startLine, nextLine - (autoClosed ? 1 : 0)];

    state.md.block.tokenize(
      state,
      startLine + 1,
      nextLine - (autoClosed ? 1 : 0)
    );

    const closeToken = state.push(`${name}_tabs_close`, "", -1);

    closeToken.markup = state.src.slice(start, pos);
    closeToken.block = true;

    state.parentType = oldParent;
    state.lineMax = oldLineMax;
    state.line = nextLine + (autoClosed ? 1 : 0);

    return true;
  };

const getTabsDataGetter =
  (name: string): ((tokens: Token[], index: number) => MarkdownItTabInfo) =>
  (tokens, index) => {
    const tabData: MarkdownItTabData[] = [];
    let activeIndex = -1;
    let isTabStart = false;

    for (let i = index; i < tokens.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { block, meta, type, info } = tokens[i];

      if (block) {
        if (type === `${name}_tabs_close`) break;
        if (type === `${name}_tabs_open`) continue;

        if (type === `${name}_tab_open`) {
          isTabStart = true;

          // code tab is active
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          if (meta.active) {
            if (activeIndex === -1) activeIndex = tabData.length;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            else meta.active = false;
          }

          tabData.push({
            title: info,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            ...(meta.id ? { id: meta.id as string } : {}),
          });

          continue;
        }

        if (type === `${name}_tab_close`) continue;

        if (!isTabStart) {
          tokens[i].type = `${name}_tabs_empty`;
          tokens[i].hidden = true;
        }
      }
    }

    return {
      active: activeIndex,
      data: tabData.map((data, index) => ({
        ...data,
        active: index === activeIndex,
      })),
    };
  };

const tabDataGetter = (tokens: Token[], index: number): MarkdownItTabData => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { info, meta } = tokens[index];

  return {
    title: info,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    ...(meta.id ? { id: meta.id as string } : {}),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    isActive: Boolean(meta.active),
  };
};

export const tab: PluginWithOptions<MarkdownItTabOptions> = (md, options) => {
  const {
    name = "tabs",

    tabsOpenRenderer = (
      info: MarkdownItTabInfo,
      tokens: Token[],
      index: number,
      _options: Options,
      _env: unknown,
      self: Renderer
    ): string => {
      const token = tokens[index];
      const { active, data } = info;

      token.attrJoin("class", `${name}-tabs-wrapper`);

      const tabs = data.map(
        ({ title, id }, index) =>
          `<button type="button" class="${name}-tab-button${
            active === index ? " active" : ""
          }" data-tab="${index}"${id ? ` data-id="${escapeHtml(id)}"` : ""}${
            active === index ? " data-active" : ""
          }>${escapeHtml(title)}</button>`
      );

      return `\
<div${self.renderAttrs(token)}>
  <div class="${name}-tabs-header">
    ${tabs.join("\n    ")}
  </div>
  <div class="${name}-tabs-container">\n`;
    },

    tabsCloseRenderer = (): string => `
  </div>
</div>`,

    tabOpenRenderer = (
      info: MarkdownItTabData,
      tokens: Token[],
      index: number,
      _options: Options,
      _env: unknown,
      self: Renderer
    ): string => {
      const token = tokens[index];

      token.attrJoin(
        "class",
        `${name}-tab-content${info.isActive ? " active" : ""}`
      );
      if (info.isActive) token.attrJoin("data-active", "");

      return `<div${self.renderAttrs(tokens[index])}>`;
    },

    tabCloseRenderer = (): string => `</div>`,
  } = options || {};

  const tabsDataGetter = getTabsDataGetter(name);

  md.block.ruler.before("fence", `${name}_tabs`, getTabsRule(name), {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });

  md.block.ruler.before("fence", `${name}_tab`, getTabRule(name), {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });

  md.renderer.rules[`${name}_tabs_open`] = (
    tokens,
    index,
    options,
    env,
    self
  ): string => {
    const info = tabsDataGetter(tokens, index);

    return tabsOpenRenderer(info, tokens, index, options, env, self);
  };

  md.renderer.rules[`${name}_tabs_close`] = tabsCloseRenderer;

  md.renderer.rules[`${name}_tab_open`] = (tokens, index, ...args): string => {
    const data = tabDataGetter(tokens, index);

    return tabOpenRenderer(data, tokens, index, ...args);
  };

  md.renderer.rules[`${name}_tab_close`] = tabCloseRenderer;
};