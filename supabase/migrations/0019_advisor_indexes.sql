-- HubChat 0019: covering indexes reported by the Supabase performance advisor
create index if not exists order_media_links_media_idx on order_media_links (media_id);
create index if not exists order_media_links_admin_idx on order_media_links (linked_by_admin_id);
create index if not exists runtime_settings_updated_by_idx on runtime_settings (updated_by);
