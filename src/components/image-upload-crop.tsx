'use client';

import { useRef, useState } from 'react';
import { Camera, Image as ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/**
 * ตัดรูปให้เป็นสี่เหลี่ยมจัตุรัส 1:1 ด้วย HTML5 Canvas บนเบราว์เซอร์
 */
async function cropToSquare(file: File, targetSize = 512): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context unavailable'));
        return;
      }

      // คำนวณตัดตรงกลางให้เป็น 1:1
      const size = Math.min(img.width, img.height);
      const startX = (img.width - size) / 2;
      const startY = (img.height - size) / 2;

      ctx.drawImage(img, startX, startY, size, size, 0, 0, targetSize, targetSize);

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Blob generation failed'));
        },
        'image/jpeg',
        0.92,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('โหลดรูปไม่สำเร็จ'));
    };

    img.src = url;
  });
}

export default function ImageUploadCrop({
  value,
  onChange,
  label = 'รูปภาพ (สัดส่วน 1:1)',
  aspect = 'square',
  rounded = 'rounded-lg',
  size = 96,
  className,
}: {
  value?: string | null;
  onChange: (url: string | null) => void;
  label?: string;
  aspect?: 'square' | 'circle';
  rounded?: string;
  size?: number;
  className?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('กรุณาเลือกไฟล์รูปภาพเท่านั้น');
      return;
    }

    setUploading(true);
    try {
      const croppedBlob = await cropToSquare(file, 600);
      const croppedFile = new File([croppedBlob], `square_${Date.now()}.jpg`, { type: 'image/jpeg' });

      const form = new FormData();
      form.append('file', croppedFile);

      const res = await fetch('/api/media-library', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json?.error?.message_th ?? 'อัปโหลดไม่สำเร็จ');
      }

      const uploadedUrl = json.data?.url || `/api/media/${json.data?.id}`;
      onChange(uploadedUrl);
      toast.success('อัปโหลดและจัดรูป 1:1 เรียบร้อย');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการอัปโหลด');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {label && <span className="text-xs font-medium text-muted-foreground">{label}</span>}
      <div className="flex items-center gap-4">
        {/* กรอบแสดงภาพพรีวิว 1:1 */}
        <div
          style={{ width: size, height: size }}
          className={cn(
            'relative shrink-0 overflow-hidden border bg-muted flex items-center justify-center shadow-inner group',
            aspect === 'circle' ? 'rounded-full' : rounded,
          )}
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="พรีวิว" className="size-full object-cover" />
          ) : (
            <ImageIcon className="size-6 text-muted-foreground/60" />
          )}

          {uploading && (
            <div className="absolute inset-0 bg-background/70 backdrop-blur-sm flex items-center justify-center">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          )}
        </div>

        {/* ปุ่มควบคุม */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
          />

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="gap-1.5"
          >
            {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            {value ? 'เปลี่ยนรูป 1:1' : 'อัปโหลดรูป 1:1'}
          </Button>

          {value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={uploading}
              onClick={() => onChange(null)}
              className="text-destructive hover:text-destructive gap-1"
            >
              <Trash2 className="size-3.5" />
              ลบ
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
