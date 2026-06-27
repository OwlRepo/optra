import * as React from 'react'
import { Bot, User2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Avatar, AvatarFallback } from './avatar'

interface ChatBubbleProps {
  role: 'user' | 'assistant' | 'system' | 'function' | 'tool' | 'data'
  content: string
  className?: string
}

export function ChatBubble({ role, content, className }: ChatBubbleProps) {
  const isUser = role === 'user'
  const isAssistant = role === 'assistant'

  return (
    <div className={cn('flex items-start gap-3', isUser && 'flex-row-reverse', className)}>
      <Avatar className="mt-1 h-10 w-10 border border-border/70 bg-card shadow-[var(--shadow-sm)]">
        <AvatarFallback
          className={cn(
            'text-xs font-semibold',
            isUser ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
          )}
        >
          {isUser ? <User2 className="size-4" /> : <Bot className="size-4" />}
        </AvatarFallback>
      </Avatar>

      <div className={cn('max-w-[85%] space-y-2', isUser && 'items-end text-right')}>
        <div className={cn('px-4 py-3 text-sm leading-6 shadow-[var(--shadow-sm)]', isUser ? 'rounded-[1.5rem] rounded-tr-md bg-primary text-primary-foreground' : 'rounded-[1.5rem] rounded-tl-md border border-border/60 bg-card/90 text-card-foreground backdrop-blur-sm')}>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] opacity-70">
            <span>{isUser ? 'You' : isAssistant ? 'Assistant' : role}</span>
          </div>
          <p className="whitespace-pre-wrap break-words">{content}</p>
        </div>
      </div>
    </div>
  )
}
