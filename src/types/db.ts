/**
 * ชนิดข้อมูลของตารางในฐานข้อมูล
 * -------------------------------------------------------------------------
 * เขียนมือให้ตรงกับ supabase/migrations/0001_init.sql
 * ถ้าแก้ SQL แล้วต้องกลับมาแก้ไฟล์นี้ด้วยเสมอ
 * (รอบถัด ๆ ไปค่อยเปลี่ยนไปใช้ `supabase gen types` ให้สร้างอัตโนมัติ)
 */

/* ---------------------------- ENUM ---------------------------- */
export type Platform = 'facebook' | 'instagram';
export type Channel = 'messenger' | 'instagram';
export type Direction = 'in' | 'out';
export type SenderType = 'customer' | 'admin' | 'bot';
export type AdminRole = 'owner' | 'admin' | 'viewer';
export type ReferralSource = 'ADS' | 'SHORTLINK' | 'POST' | 'ORGANIC';
export type MatchType = 'exact' | 'contains' | 'starts_with';
export type PaymentMethod = 'cod' | 'transfer';
export type PaymentStatus = 'unpaid' | 'deposit' | 'paid';
export type OrderStatus =
  | 'draft' | 'confirmed' | 'paid' | 'packed'
  | 'shipped' | 'completed' | 'cancelled' | 'returned';
export type NotifyStatus = 'pending' | 'sent' | 'blocked' | 'skipped';
export type MessageType =
  | 'inquiry_response' | 'order_update' | 'shipping_update'
  | 'appointment_reminder' | 'promotion' | 'upsell';
export type Transport = 'STANDARD' | 'HUMAN_AGENT' | 'UTILITY' | 'MARKETING';
export type TriggeredBy = 'admin' | 'bot' | 'scheduler';
export type FollowUpType = 'day3' | 'day7' | 'day14' | 'day30' | 'custom';
export type FollowUpStatus = 'scheduled' | 'sent' | 'blocked' | 'cancelled';
export type ImportStatus = 'parsing' | 'review' | 'applied' | 'cancelled';
export type MatchMethod = 'order_ref' | 'phone' | 'phone_postcode' | 'name_postcode' | 'manual';
export type MatchStatus = 'auto' | 'ambiguous' | 'manual' | 'unmatched' | 'skipped';
export type Courier = 'flash' | 'kerry' | 'jt' | 'thailand_post' | 'custom';
export type PromotionType = 'single' | 'bundle' | 'buy_x_get_y' | 'boxset';
export type QueueStatus = 'pending' | 'processing' | 'done' | 'failed';
export type DevicePlatform = 'ios' | 'android' | 'desktop';
export type InboxStatus = 'active' | 'done' | 'spam';

/* ------------------------ โครงย่อยใน jsonb ------------------------ */
export type ImageRef = {
  media_id?: string;
  name?: string;
  mime?: string;
  r2_key?: string;
  drive_file_id?: string;
  meta_attachment_id?: string;
  url?: string;
};
export type Attachment = { type: string; r2_key?: string; drive_file_id?: string; url?: string };
export type OrderItem = {
  product_id?: string;
  name: string;
  variant?: string;
  qty: number;
  unit_price: number;
  total: number;
};

/* ---------------------------- ตาราง ---------------------------- */

export type Admin = {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: AdminRole;
  allowed_page_ids: string[];
  must_change_password: boolean;
  is_active: boolean;
  last_seen_at: string | null;
  last_login_ip: string | null;
  session_version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** ข้อมูลแอดมินที่ปลอดภัยพอจะส่งออก API — ไม่มี password_hash เด็ดขาด */
export type PublicAdmin = Omit<Admin, 'password_hash'>;

export type Page = {
  id: string;
  platform: Platform;
  page_id: string;
  page_name: string;
  display_name: string | null;
  tag_color: string;
  access_token: string | null; // เข้ารหัสแล้ว ห้ามส่งออก API
  is_active: boolean;
  created_at: string;
};

export type Customer = {
  id: string;
  page_id: string;
  psid: string;
  platform: Platform;
  name: string | null;
  profile_pic_url: string | null;
  phone: string | null;
  address: string | null;
  postcode: string | null;
  recipient_name: string | null;
  total_orders: number;
  total_spent: number;
  first_purchase_date: string | null;
  last_purchase_date: string | null;
  first_contact_at: string;
  last_customer_message_at: string | null;
  last_admin_message_at: string | null;
  marketing_eligible: boolean;
  marketing_checked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Conversation = {
  id: string;
  customer_id: string;
  page_id: string;
  last_message_at: string;
  last_message_preview: string | null;
  last_customer_message_at: string | null;
  is_read: boolean;
  inbox_status: InboxStatus;
  is_important: boolean;
  inbox_state_updated_at: string | null;
  inbox_state_updated_by: string | null;
  meta_spam_synced_at: string | null;
  has_ai_reply: boolean;
  has_ai_handoff: boolean;
  assigned_admin_id: string | null;
  locked_by_admin_id: string | null;
  locked_at: string | null;
  referral_source: ReferralSource | null;
  referral_ad_id: string | null;
  referral_post_id: string | null;
  referral_ref: string | null;
  created_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  direction: Direction;
  sender_type: SenderType;
  admin_id: string | null;
  text: string | null;
  attachments: Attachment[];
  sent_with_human_agent_tag: boolean;
  meta_message_id: string | null;
  is_deleted: boolean;
  created_at: string;
};

export type KeywordRule = {
  id: string;
  name: string | null;
  page_ids: string[];
  match_type: MatchType;
  keywords: string[];
  reply_text: string | null;
  reply_images: ImageRef[];
  priority: number;
  is_active: boolean;
  hit_count: number;
  created_at: string;
};

export type CannedResponse = {
  id: string;
  category: string | null;
  title: string;
  shortcut: string | null;
  text: string | null;
  images: ImageRef[];
  use_count: number;
  sort_order: number;
  created_at: string;
};

export type Order = {
  id: string;
  order_no: string;
  conversation_id: string | null;
  customer_id: string | null;
  page_id: string | null;
  source_message_id: string | null;
  recipient_name: string | null;
  phone: string | null;
  address: string | null;
  postcode: string | null;
  items: OrderItem[];
  subtotal: number;
  shipping_fee: number;
  discount: number;
  total: number;
  payment_method: PaymentMethod | null;
  payment_status: PaymentStatus;
  slip_url: string | null;
  paid_at: string | null;
  shipping_carrier: string | null;
  tracking_no: string | null;
  shipped_at: string | null;
  tracking_import_id: string | null;
  tracking_notified_at: string | null;
  tracking_notify_status: NotifyStatus | null;
  tracking_notify_reason_th: string | null;
  status: OrderStatus;
  referral_ad_id: string | null;
  referral_post_id: string | null;
  first_contact_at: string | null;
  closed_at: string | null;
  internal_note: string | null;
  created_by_admin_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SendAttempt = {
  id: string;
  customer_id: string | null;
  conversation_id: string | null;
  channel: Channel;
  message_type: MessageType;
  selected_transport: Transport | null;
  policy_reason_code: string;
  policy_reason_th: string;
  meta_response_code: number | null;
  meta_error_subcode: number | null;
  meta_error_message: string | null;
  fbtrace_id: string | null;
  success: boolean;
  estimated_cost: number | null;
  triggered_by: TriggeredBy;
  admin_id: string | null;
  sent_at: string | null;
  created_at: string;
};

export type FollowUp = {
  id: string;
  customer_id: string;
  conversation_id: string | null;
  order_id: string | null;
  follow_up_type: FollowUpType;
  follow_up_date: string;
  message_type: MessageType;
  draft_text: string | null;
  template_id: string | null;
  template_params: Record<string, unknown>;
  status: FollowUpStatus;
  policy_decision: Record<string, unknown> | null;
  blocked_reason_th: string | null;
  created_by: string | null;
  created_at: string;
  executed_at: string | null;
};

export type TrackingImport = {
  id: string;
  filename: string;
  courier: Courier | null;
  template_id: string | null;
  total_rows: number;
  matched_auto: number;
  matched_manual: number;
  unmatched: number;
  status: ImportStatus;
  file_hash: string;
  notified_count: number;
  blocked_count: number;
  uploaded_by: string | null;
  created_at: string;
  applied_at: string | null;
};

export type TrackingImportRow = {
  id: string;
  import_id: string;
  raw_row: Record<string, unknown>;
  tracking_no: string | null;
  phone_raw: string | null;
  phone_normalized: string | null;
  postcode: string | null;
  recipient_name: string | null;
  matched_order_id: string | null;
  match_method: MatchMethod | null;
  match_status: MatchStatus;
  candidate_order_ids: string[];
  created_at: string;
};

export type CourierTemplate = {
  id: string;
  courier_name: Courier;
  label: string | null;
  column_mapping: Record<string, string>;
  detect_headers: string[];
  created_by: string | null;
  created_at: string;
};

export type OrderLog = {
  id: string;
  order_id: string;
  admin_id: string | null;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
};

export type Product = {
  id: string;
  name: string;
  sku: string | null;
  variant: string | null;
  price: number;
  image_url: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

export type Promotion = {
  id: string;
  name: string;
  type: PromotionType;
  config: Record<string, unknown>;
  price: number | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

export type Tag = {
  id: string;
  name: string;
  color: string;
  is_auto: boolean;
  sort_order: number;
  created_at: string;
};

export type ConversationTag = {
  conversation_id: string;
  tag_id: string;
  added_by: string | null;
  created_at: string;
};

export type Comment = {
  id: string;
  page_id: string;
  post_id: string | null;
  comment_id: string;
  parent_comment_id: string | null;
  from_name: string | null;
  from_id: string | null;
  message: string | null;
  is_handled: boolean;
  handled_by: string | null;
  handled_at: string | null;
  replied_public: boolean;
  replied_private: boolean;
  created_at: string;
};

export type PushSubscription = {
  id: string;
  admin_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  device_label: string | null;
  platform: DevicePlatform | null;
  last_used_at: string | null;
  created_at: string;
};

export type NotificationPref = {
  id: string;
  admin_id: string;
  enabled_events: string[];
  page_ids: string[];
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  sound_enabled: boolean;
  created_at: string;
};

export type ActivityLog = {
  id: string;
  admin_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
};

export type AppSetting = {
  key: string;
  value: unknown;
  updated_by: string | null;
  updated_at: string;
};

export type WebhookQueueItem = {
  id: number;
  payload: Record<string, unknown>;
  status: QueueStatus;
  attempts: number;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
};

export type LoginAttempt = {
  id: number;
  email: string;
  ip_address: string | null;
  success: boolean;
  user_agent: string | null;
  created_at: string;
};

/** รายชื่อตารางทั้งหมด — ใช้ตอนตรวจว่า migration ขึ้นครบหรือยัง */
export const ALL_TABLES = [
  'admins', 'pages', 'products', 'promotions', 'tags', 'customers',
  'conversations', 'messages', 'conversation_tags', 'keyword_rules',
  'canned_responses', 'courier_templates', 'tracking_imports', 'orders',
  'order_no_counters', 'tracking_import_rows', 'order_logs', 'send_attempts',
  'follow_ups', 'comments', 'push_subscriptions', 'notification_prefs',
  'activity_logs', 'app_settings', 'webhook_queue', 'login_attempts',
] as const;
