<script lang="ts">
  import { sessions } from '../stores/sessions'
  import { activeSessionId, showFileBrowser } from '../stores/ui'
  import type { FileEntry } from '../types'

  let files = $state<FileEntry[]>([])
  let currentPath = $state('')
  let previewContent = $state<string | null>(null)
  let previewFile = $state('')

  const activeSession = $derived($sessions.find((s) => s.id === $activeSessionId))

  $effect(() => {
    if (activeSession && $showFileBrowser) {
      loadFiles('')
    }
  })

  async function loadFiles(subPath: string) {
    if (!activeSession) return
    currentPath = subPath
    previewContent = null
    files = await window.api.fileList(activeSession.workingDir, subPath)
  }

  async function handleClick(file: FileEntry) {
    if (file.isDirectory) {
      await loadFiles(file.path)
    } else {
      if (!activeSession) return
      try {
        previewContent = await window.api.fileRead(activeSession.workingDir, file.path)
        previewFile = file.name
      } catch {
        previewContent = '[Unable to read file]'
        previewFile = file.name
      }
    }
  }

  async function handleDownload(file: FileEntry, e: MouseEvent) {
    e.stopPropagation()
    if (!activeSession) return
    const destPath = await window.api.fileDownload(activeSession.workingDir, file.path)
    console.log('Downloaded to:', destPath)
  }

  function goUp() {
    const parts = currentPath.split('/')
    parts.pop()
    loadFiles(parts.join('/'))
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
</script>

{#if $showFileBrowser && activeInstance}
  <div class="file-browser">
    <div class="browser-header">
      <h3>Files</h3>
      <button class="close-btn" onclick={() => showFileBrowser.set(false)}>x</button>
    </div>

    <div class="path-bar">
      {#if currentPath}
        <button class="back-btn" onclick={goUp}>.. up</button>
      {/if}
      <span class="current-path">/{currentPath}</span>
    </div>

    {#if previewContent !== null}
      <div class="preview">
        <div class="preview-header">
          <span>{previewFile}</span>
          <button onclick={() => { previewContent = null }}>Back</button>
        </div>
        <pre class="preview-content">{previewContent}</pre>
      </div>
    {:else}
      <div class="file-list">
        {#if files.length === 0}
          <p class="empty">No files in workspace</p>
        {:else}
          {#each files as file}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="file-row" onclick={() => handleClick(file)} onkeydown={(e) => e.key === 'Enter' && handleClick(file)} role="button" tabindex="0">
              <span class="file-icon">{file.isDirectory ? '>' : ' '}</span>
              <span class="file-name">{file.name}</span>
              {#if !file.isDirectory}
                <span class="file-size">{formatSize(file.size)}</span>
                <button class="download-btn" onclick={(e) => handleDownload(file, e)} title="Download">
                  DL
                </button>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .file-browser {
    width: 300px;
    min-width: 300px;
    background: #181825;
    border-left: 1px solid #313244;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .browser-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px;
    border-bottom: 1px solid #313244;
  }

  .browser-header h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: #cdd6f4;
  }

  .close-btn {
    background: none;
    border: none;
    color: #6c7086;
    cursor: pointer;
    font-size: 14px;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .close-btn:hover {
    background: #313244;
    color: #cdd6f4;
  }

  .path-bar {
    padding: 8px 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid #313244;
  }

  .back-btn {
    background: #313244;
    border: none;
    border-radius: 4px;
    color: #89b4fa;
    font-size: 11px;
    padding: 2px 8px;
    cursor: pointer;
  }

  .back-btn:hover {
    background: #45475a;
  }

  .current-path {
    font-size: 11px;
    color: #6c7086;
    font-family: monospace;
  }

  .file-list {
    flex: 1;
    overflow-y: auto;
  }

  .file-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    background: none;
    border: none;
    border-bottom: 1px solid #1e1e2e;
    color: #cdd6f4;
    cursor: pointer;
    font-size: 12px;
    text-align: left;
  }

  .file-row:hover {
    background: #1e1e2e;
  }

  .file-icon {
    color: #89b4fa;
    font-family: monospace;
    width: 12px;
  }

  .file-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-size {
    font-size: 10px;
    color: #585b70;
  }

  .download-btn {
    background: #313244;
    border: none;
    border-radius: 4px;
    color: #a6e3a1;
    font-size: 10px;
    padding: 2px 6px;
    cursor: pointer;
  }

  .download-btn:hover {
    background: #45475a;
  }

  .empty {
    padding: 20px;
    text-align: center;
    color: #6c7086;
    font-size: 12px;
  }

  .preview {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .preview-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid #313244;
    font-size: 12px;
    color: #a6adc8;
  }

  .preview-header button {
    background: #313244;
    border: none;
    border-radius: 4px;
    color: #89b4fa;
    font-size: 11px;
    padding: 2px 8px;
    cursor: pointer;
  }

  .preview-content {
    flex: 1;
    overflow: auto;
    padding: 12px;
    font-size: 11px;
    font-family: monospace;
    color: #cdd6f4;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
