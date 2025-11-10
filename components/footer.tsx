'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Github } from 'lucide-react'
import { AboutModal } from './about-modal'

export function Footer() {
  const [aboutModalOpen, setAboutModalOpen] = useState(false)

  return (
    <>
      <footer className="border-t border-[#f0f1f1] bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-6 py-8 text-[14px] text-[#8d8d8d]">
          <Github className="h-4 w-4" />
          <Link
            href="https://github.com/SamuelZ12/tldw"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-[#5c5c5c]"
          >
            Open Source
          </Link>
          <span className="text-[#d0d0d0]">•</span>
          <button
            onClick={() => setAboutModalOpen(true)}
            className="transition-colors hover:text-[#5c5c5c]"
          >
            About Us
          </button>
        </div>
      </footer>
      <AboutModal open={aboutModalOpen} onOpenChange={setAboutModalOpen} />
    </>
  )
}
