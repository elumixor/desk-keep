<script lang="ts">
  import type { DocNode } from "$model/document";

  /** A page body drawn read-only and small: the common blocks and marks, anything else skipped. */
  let { nodes }: { nodes: readonly DocNode[] } = $props();

  const mark = (node: DocNode, type: string) => node.marks?.some((m) => m.type === type) ?? false;
</script>

{#snippet inline(node: DocNode)}
  {#if node.type === "text"}
    <span class:font-semibold={mark(node, "bold")} class:italic={mark(node, "italic")} class:line-through={mark(node, "strike")} class:underline={mark(node, "link")} class:font-mono={mark(node, "code")}>{node.text}</span>
  {:else if node.type === "hardBreak"}<br />
  {:else if node.content}{#each node.content as child}{@render inline(child)}{/each}
  {/if}
{/snippet}

{#snippet block(node: DocNode)}
  {#if node.type === "paragraph"}
    <p class="my-1.5">{#each node.content ?? [] as child}{@render inline(child)}{/each}</p>
  {:else if node.type === "heading"}
    <p class="mb-1 mt-3 font-semibold text-ink {node.attrs?.level === 1 ? 'text-[17px]' : node.attrs?.level === 2 ? 'text-[15px]' : ''}">{#each node.content ?? [] as child}{@render inline(child)}{/each}</p>
  {:else if node.type === "bulletList" || node.type === "taskList"}
    <ul class="my-1.5 list-disc pl-5">{#each node.content ?? [] as item}<li>{#each item.content ?? [] as child}{@render block(child)}{/each}</li>{/each}</ul>
  {:else if node.type === "orderedList"}
    <ol class="my-1.5 list-decimal pl-5">{#each node.content ?? [] as item}<li>{#each item.content ?? [] as child}{@render block(child)}{/each}</li>{/each}</ol>
  {:else if node.type === "blockquote"}
    <blockquote class="my-1.5 border-l-2 border-line pl-3 italic">{#each node.content ?? [] as child}{@render block(child)}{/each}</blockquote>
  {:else if node.type === "codeBlock"}
    <pre class="my-1.5 overflow-hidden rounded-md bg-ink-5 p-2 font-mono text-[12px]">{#each node.content ?? [] as child}{child.text}{/each}</pre>
  {:else if node.type === "details"}
    {@const [summary, content] = node.content ?? []}
    <p class="my-1.5">▸ {#each summary?.content ?? [] as child}{@render inline(child)}{/each}</p>
    <div class="pl-4">{#each content?.content ?? [] as child}{@render block(child)}{/each}</div>
  {:else if node.type === "horizontalRule"}
    <hr class="my-2 border-line" />
  {/if}
{/snippet}

{#each nodes as node}{@render block(node)}{/each}
