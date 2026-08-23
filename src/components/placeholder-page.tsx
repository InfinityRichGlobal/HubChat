import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/**
 * หน้าที่ยังไม่ได้ทำในรอบนี้
 * ตั้งใจใส่ไว้เพื่อให้เห็นโครงเมนูครบ และรู้ว่าอะไรจะมาในรอบไหน
 */
export default function PlaceholderPage({
  title,
  round,
  description,
  items,
}: {
  title: string;
  round: string;
  description: string;
  items: string[];
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>{title}</CardTitle>
          <Badge variant="secondary">{round}</Badge>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
