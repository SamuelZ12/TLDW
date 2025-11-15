'use client'

import { Toaster } from 'sonner'

export function ToastProvider() {
  return (
    <Toaster
      position="bottom-right"
      richColors
      expand={false}
      closeButton
      duration={4000}
    />
  )
}