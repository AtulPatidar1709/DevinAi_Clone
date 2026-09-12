import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown-body text-sm leading-6 text-zinc-300">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => <h1 className="mb-2 mt-4 text-lg font-semibold text-white first:mt-0" {...props} />,
          h2: (props) => <h2 className="mb-2 mt-4 text-base font-semibold text-white first:mt-0" {...props} />,
          h3: (props) => <h3 className="mb-1.5 mt-3 text-sm font-semibold text-white first:mt-0" {...props} />,
          p: (props) => <p className="mb-3 last:mb-0" {...props} />,
          ul: (props) => <ul className="mb-3 ml-4 list-disc space-y-1 last:mb-0" {...props} />,
          ol: (props) => <ol className="mb-3 ml-4 list-decimal space-y-1 last:mb-0" {...props} />,
          li: (props) => <li className="text-zinc-300" {...props} />,
          strong: (props) => <strong className="font-semibold text-zinc-100" {...props} />,
          a: (props) => (
            <a
              className="text-zinc-100 underline decoration-zinc-600 underline-offset-2 hover:decoration-zinc-300"
              target="_blank"
              rel="noreferrer"
              {...props}
            />
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = /language-/.test(className || "");
            if (isBlock) {
              return (
                <code className={`${className ?? ""} block`} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-[12px] text-zinc-200" {...props}>
                {children}
              </code>
            );
          },
          pre: (props) => (
            <pre
              className="mb-3 overflow-x-auto rounded-xl border border-white/[0.06] bg-black/40 p-3 font-mono text-[12px] leading-5 text-zinc-300 last:mb-0"
              {...props}
            />
          ),
          table: (props) => (
            <div className="mb-3 overflow-x-auto rounded-lg border border-white/[0.08] last:mb-0">
              <table className="w-full border-collapse text-left text-[13px]" {...props} />
            </div>
          ),
          thead: (props) => <thead className="bg-white/[0.04]" {...props} />,
          th: (props) => (
            <th className="border-b border-white/[0.08] px-3 py-2 font-medium text-zinc-400" {...props} />
          ),
          td: (props) => (
            <td className="border-b border-white/[0.04] px-3 py-2 align-top text-zinc-300 last:border-b-0" {...props} />
          ),
          blockquote: (props) => (
            <blockquote className="mb-3 border-l-2 border-white/20 pl-3 text-zinc-500 last:mb-0" {...props} />
          ),
          hr: (props) => <hr className="my-4 border-white/[0.08]" {...props} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
