'use client'

import * as React from 'react'
import Link from 'next/link'
import { useChat } from 'ai/react'
import {
  AppHeader,
  Badge,
  Button,
  Card,
  ChatBubble,
  EmptyState,
  Input,
  PageShell,
  StatusBanner,
  useToast,
} from '@repo/ui'
import {
  AlertTriangle,
  Bot,
  MessageSquareText,
  RefreshCcw,
  Send,
  Sparkles,
  Square,
  WandSparkles,
} from 'lucide-react'

const suggestedPrompts = [
  'How do I reset a password for a customer account?',
  'What is our refund policy for annual plans?',
  'Customer cannot access invoices after SSO migration. What should support do?',
  'Give me troubleshooting steps for failed login with 2FA enabled.',
]

export default function ChatPage() {
  const { toast } = useToast()
  const [lastCompletedAt, setLastCompletedAt] = React.useState<string | null>(null)
  const [showRecoveredBanner, setShowRecoveredBanner] = React.useState(false)
  const recoveringRef = React.useRef(false)
  const bottomRef = React.useRef<HTMLDivElement | null>(null)

  const {
    messages,
    input,
    setInput,
    handleInputChange,
    handleSubmit,
    isLoading,
    error,
    reload,
    stop,
  } = useChat({
    api: '/api/chat',
    keepLastMessageOnError: true,
    onError: (chatError) => {
      toast({
        variant: 'error',
        title: 'Assistant unavailable',
        description: chatError.message || 'We could not complete your request. Retry when ready.',
      })
    },
    onFinish: () => {
      setLastCompletedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
      if (recoveringRef.current) {
        toast({
          variant: 'success',
          title: 'Response ready',
          description: 'Assistant recovered and completed your latest request.',
        })
        setShowRecoveredBanner(true)
      }
      recoveringRef.current = false
    },
  })

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  React.useEffect(() => {
    if (!error) {
      return
    }
    setShowRecoveredBanner(false)
  }, [error])

  const submitForm = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!input.trim() || isLoading) {
      return
    }
    setShowRecoveredBanner(false)
    handleSubmit(event)
  }

  const retryLastRequest = async () => {
    recoveringRef.current = true
    setShowRecoveredBanner(false)
    try {
      await reload()
    } catch {
      recoveringRef.current = false
    }
  }

  return (
    <PageShell contentClassName="pb-16">
      <AppHeader
        className="mt-4 rounded-[calc(var(--radius)+0.5rem)] border border-border/70 bg-background/75"
        brand={
          <Link href="/" className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[var(--shadow-md)]">
            <Sparkles className="size-5" />
          </Link>
        }
        title="Assistant workspace"
        description="Grounded support answers with calm, obvious loading and failure states."
        badge={<Badge variant="secondary">Streaming chat</Badge>}
        navigation={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/">Overview</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          </>
        }
        actions={
          <Badge variant="outline">
            <Bot className="size-3.5" />
            Human-friendly UX
          </Badge>
        }
      />

      <div className="grid gap-6 pb-6 pt-10 xl:grid-cols-[1.2fr_0.8fr]">
        <Card variant="elevated" className="flex min-h-[70vh] flex-col overflow-hidden">
          <div className="border-b border-border/70 px-6 py-5 sm:px-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-primary">Knowledge-backed assistant</p>
                <h2 className="mt-1 text-2xl font-semibold">Ask support questions in plain language</h2>
              </div>
              <div className="flex items-center gap-2">
                {isLoading ? <Badge variant="secondary">Searching</Badge> : <Badge variant="success">Ready</Badge>}
                {lastCompletedAt ? <Badge variant="outline">Updated {lastCompletedAt}</Badge> : null}
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-6 sm:px-8">
            {error ? (
              <StatusBanner
                variant="error"
                title="Request interrupted"
                description={error.message || 'Assistant could not complete response.'}
                action={
                  <Button size="sm" variant="outline" onClick={retryLastRequest}>
                    <RefreshCcw className="size-4" />
                    Retry
                  </Button>
                }
              />
            ) : null}

            {showRecoveredBanner && !error ? (
              <StatusBanner
                variant="success"
                title="Response delivered"
                description="Assistant recovered and completed latest answer successfully."
              />
            ) : null}

            {isLoading ? (
              <StatusBanner
                variant="loading"
                title="Working on answer"
                description="Searching knowledge base and drafting grounded response."
              />
            ) : null}

            {messages.length === 0 ? (
              <EmptyState
                icon={<MessageSquareText className="size-5" />}
                title="Start with a real support question"
                description="Use prompt suggestions below or type your own. Interface will show clear progress, safe errors, and recovery actions while assistant works."
                actions={
                  <div className="flex flex-wrap justify-center gap-2">
                    {suggestedPrompts.slice(0, 2).map((prompt) => (
                      <Button key={prompt} variant="outline" size="sm" onClick={() => setInput(prompt)}>
                        {prompt}
                      </Button>
                    ))}
                  </div>
                }
              />
            ) : (
              <div className="space-y-5">
                {messages.map((message) => (
                  <ChatBubble key={message.id} role={message.role} content={message.content} className="fade-slide-in" />
                ))}
                {isLoading ? (
                  <div className="flex items-center gap-3 rounded-[calc(var(--radius)+0.25rem)] border border-border/70 bg-secondary/60 px-4 py-3 text-sm text-muted-foreground shadow-[var(--shadow-sm)]">
                    <WandSparkles className="size-4 text-primary" />
                    Generating answer with retrieved context…
                  </div>
                ) : null}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <div className="border-t border-border/70 bg-background/70 px-6 py-5 backdrop-blur-sm sm:px-8">
            <form onSubmit={submitForm} className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  value={input}
                  onChange={handleInputChange}
                  placeholder="Ask a support question…"
                  className="h-12 flex-1 text-base"
                  disabled={isLoading}
                />
                <div className="flex gap-3">
                  {isLoading ? (
                    <Button type="button" variant="outline" size="lg" onClick={stop}>
                      <Square className="size-4" />
                      Stop
                    </Button>
                  ) : null}
                  <Button type="submit" size="lg" isLoading={isLoading} loadingText="Sending">
                    {!isLoading ? <Send className="size-4" /> : null}
                    {!isLoading ? 'Send' : null}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Tip: Ask for policy steps, troubleshooting flows, or approved reply language.
              </p>
            </form>
          </div>
        </Card>

        <div className="space-y-6">
          <Card variant="gradient" className="p-6">
            <div className="flex items-start gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <AlertTriangle className="size-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-primary">Calm failure handling</p>
                <h3 className="mt-1 text-xl font-semibold">Operators always know what happened</h3>
              </div>
            </div>
            <ul className="mt-5 space-y-3 text-sm leading-7 text-muted-foreground">
              <li>• Inline error banner explains issue in plain language.</li>
              <li>• Retry action stays visible after failed requests.</li>
              <li>• Toasts confirm recovery only when something changed.</li>
            </ul>
          </Card>

          <Card variant="subtle" className="p-6">
            <p className="text-sm font-semibold text-primary">Suggested prompts</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {suggestedPrompts.map((prompt) => (
                <Button key={prompt} variant="outline" size="sm" className="h-auto whitespace-normal py-2 text-left" onClick={() => setInput(prompt)}>
                  {prompt}
                </Button>
              ))}
            </div>
          </Card>

          <Card variant="subtle" className="p-6">
            <p className="text-sm font-semibold text-primary">What this redesign now covers</p>
            <ul className="mt-4 space-y-3 text-sm leading-7 text-muted-foreground">
              <li>• Polished public SaaS shell with consistent typography and spacing.</li>
              <li>• Shared toast system for loading, success, and error feedback.</li>
              <li>• Route-level loading and error boundaries for smooth transitions.</li>
              <li>• API error hardening so broken requests do not fail silently.</li>
            </ul>
          </Card>
        </div>
      </div>
    </PageShell>
  )
}
