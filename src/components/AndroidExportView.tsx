import React, { useState } from 'react';
import { Check, Copy, Download, FolderArchive, Info } from 'lucide-react';
import { ANDROID_KOTLIN_FILES, KotlinSourceFile } from '../android/kotlinTemplates';

export const AndroidExportView: React.FC = () => {
  const [selectedFileId, setSelectedFileId] = useState<string>(ANDROID_KOTLIN_FILES[0].id);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const activeFile: KotlinSourceFile =
    ANDROID_KOTLIN_FILES.find((f) => f.id === selectedFileId) ?? ANDROID_KOTLIN_FILES[0];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeFile.code);
      setCopiedId(activeFile.id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Ignore if clipboard permission is unavailable
    }
  };

  const handleDownloadFile = () => {
    const blob = new Blob([activeFile.code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100 text-balance">
            Android System Overlay Project
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-slate-400">
            Production Gradle + Kotlin Android 10+ (API 29+) project with <code className="font-mono text-slate-200">MediaProjection</code> capture, <code className="font-mono text-slate-200">OpenCV 4.9.0</code> vision detection, and touch-passthrough <code className="font-mono text-slate-200">TYPE_APPLICATION_OVERLAY</code> reflections.
          </p>
        </div>

        <a
          href="/CueSight-Android-Project.zip"
          download="CueSight-Android-Project.zip"
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-sky-400 whitespace-nowrap shrink-0"
        >
          <FolderArchive className="h-4 w-4" />
          Download Android Project (.zip)
        </a>
      </div>

      {/* Build info banner */}
      <div className="flex items-start gap-3 rounded-xl border border-slate-800 bg-[#111720] p-4 text-xs leading-relaxed text-slate-300">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
        <div>
          <span className="font-semibold text-slate-100">How to compile the installable APK:</span>{' '}
          sync this workspace directly to GitHub and trigger the included <code className="font-mono text-slate-200">buddy.yml</code> or <code className="font-mono text-slate-200">.github/workflows/build-apk.yml</code> pipeline, or download{' '}
          <a
            href="/CueSight-Android-Project.zip"
            download="CueSight-Android-Project.zip"
            className="font-medium text-sky-400 underline underline-offset-2 hover:text-sky-300"
          >
            CueSight-Android-Project.zip
          </a>{' '}
          and open <code className="font-mono text-slate-200">android-project/</code> in Android Studio.
        </div>
      </div>

      {/* 4-Step Setup Architecture */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-[#111720] p-4">
          <div className="text-xs font-medium text-sky-400">01. Setup &amp; Sliders</div>
          <div className="mt-1 text-sm font-semibold text-slate-100">Permissions &amp; Presets</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            <code className="font-mono text-slate-300">MainActivity.kt</code> requests overlay &amp; <code className="font-mono text-slate-300">MediaProjection</code> access with Max Bounces (1–4), Ball Radius Offset, and Felt Color (Blue/Green/Red).
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#111720] p-4">
          <div className="text-xs font-medium text-emerald-400">02. OpenCV Vision</div>
          <div className="mt-1 text-sm font-semibold text-slate-100">Table, Cue &amp; Aim</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            <code className="font-mono text-slate-300">PoolVisionProcessor.kt</code> uses HSV contours, <code className="font-mono text-slate-300">HoughCircles</code>, and <code className="font-mono text-slate-300">Canny + HoughLinesP</code> at ~18 FPS.
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#111720] p-4">
          <div className="text-xs font-medium text-amber-400">03. Lock &amp; Shoot</div>
          <div className="mt-1 text-sm font-semibold text-slate-100">Touch Passthrough</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            <code className="font-mono text-slate-300">FLAG_NOT_TOUCHABLE</code> passes shots straight to your game while the draggable <span className="text-slate-200">LOCK / UNLOCK</span> widget freezes trajectories.
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#111720] p-4">
          <div className="text-xs font-medium text-violet-400">04. Cloud APK Build</div>
          <div className="mt-1 text-sm font-semibold text-slate-100">Buddy &amp; GitHub Actions</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Preconfigured <code className="font-mono text-slate-300">buddy.yml</code> and <code className="font-mono text-slate-300">build-apk.yml</code> compile <code className="font-mono text-slate-300">app-debug.apk</code> targeting API 29–34.
          </p>
        </div>
      </div>

      {/* File Explorer & Code Viewer */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#111720]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-[#0D1219] px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-1">
            {ANDROID_KOTLIN_FILES.map((file) => (
              <button
                key={file.id}
                type="button"
                onClick={() => setSelectedFileId(file.id)}
                className={`min-h-[38px] rounded-lg px-3 py-1.5 font-mono text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  selectedFileId === file.id
                    ? 'bg-slate-800 text-sky-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {file.filename}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 whitespace-nowrap shrink-0"
            >
              {copiedId === activeFile.id ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy File
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleDownloadFile}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              Save
            </button>
          </div>
        </div>

        <div className="border-b border-slate-800/80 bg-[#0F151D] px-4 py-2 text-xs text-slate-400">
          <span className="font-mono text-slate-300">{activeFile.path}</span>
          <span className="mx-2" aria-hidden="true">·</span>
          <span>{activeFile.description}</span>
        </div>

        <div className="max-h-[520px] overflow-auto bg-[#0B0F14] p-4">
          <pre className="font-mono text-xs leading-relaxed text-slate-200">
            <code>{activeFile.code}</code>
          </pre>
        </div>
      </div>
    </div>
  );
};
