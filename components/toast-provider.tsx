'use client'

import { Toaster } from 'sonner'

export function ToastProvider() {
  return (
    <Toaster
      position="top-center"
      richColors
      expand={false}
      closeButton
      duration={4000}
    />
  )
}