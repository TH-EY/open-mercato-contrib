import { Migration } from '@mikro-orm/migrations';

export class Migration20261121140911_public_info_requests extends Migration {

  override name = 'Migration20261121140911';

  override up(): void | Promise<void> {
    this.addSql(`create table "public_info_departments" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "symbol" text not null, "kind" text not null default 'department', "competence_scope" text not null default '', "keywords" jsonb null, "contract_codes" jsonb null, "contact_hint" text null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "public_info_departments_scope_idx" on "public_info_departments" ("organization_id", "tenant_id");`);

    this.addSql(`create table "public_info_department_queries" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "request_id" uuid not null, "department_id" uuid not null, "point_positions" jsonb not null, "scope_text" text not null, "internal_due_date" date null, "sent_at" date null, "received_at" date null, "reply_kind" text null, "reply_attachment_ids" jsonb null, "ai_confidence" real null, "ai_sources" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "public_info_department_queries_request_idx" on "public_info_department_queries" ("request_id");`);

    this.addSql(`create table "public_info_documents" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "request_id" uuid not null, "attachment_id" uuid null, "department_query_id" uuid null, "kind" text not null default 'request', "file_name" text not null, "mime_type" text null, "extracted_text" text null, "text_source" text not null default 'none', "ocr_confidence" real null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "public_info_documents_request_idx" on "public_info_documents" ("request_id");`);

    this.addSql(`create table "public_info_redaction_marks" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "request_id" uuid not null, "target_kind" text not null, "draft_id" uuid null, "paragraph_id" text null, "attachment_id" uuid null, "start_offset" int not null, "end_offset" int not null, "source_hash" text not null, "text_excerpt" text not null, "category" text not null, "detector" text not null default 'rule', "state" text not null default 'suggested', "reason" text null, "decided_by_user_id" uuid null, "decided_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "public_info_redaction_marks_request_idx" on "public_info_redaction_marks" ("request_id");`);

    this.addSql(`create table "public_info_requests" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "case_number" text not null, "case_seq" int not null, "case_year" int not null, "channel" text not null, "received_at" date not null, "letter_date" date null, "requester_name" text not null, "requester_kind" text not null default 'person', "requester_address" text null, "requester_contact" text null, "delivery_form" text not null default 'email', "subject_summary" text not null, "body_text" text null, "status" text not null default 'new', "assignee_user_id" uuid null, "statutory_due_date" date not null, "current_due_date" date not null, "due_shifted_from" date null, "max_extension_date" date not null, "extended_at" timestamptz null, "extension_reason" text null, "paused_at" timestamptz null, "clarification_delivered_at" date null, "clarification_due_date" date null, "responded_at" date null, "response_channel" text null, "final_letter_type" text null, "similar_choice" jsonb null, "archive_text" text null, "source" text not null default 'manual', "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "public_info_requests_status_idx" on "public_info_requests" ("organization_id", "tenant_id", "status");`);
    this.addSql(`create index "public_info_requests_calendar_idx" on "public_info_requests" ("organization_id", "tenant_id", "case_year", "current_due_date");`);
    this.addSql(`alter table "public_info_requests" add constraint "public_info_requests_case_number_unique" unique ("organization_id", "case_number");`);

    this.addSql(`create table "public_info_request_events" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "request_id" uuid not null, "kind" text not null, "actor_user_id" uuid null, "payload" jsonb null, "occurred_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "public_info_request_events_request_idx" on "public_info_request_events" ("request_id", "occurred_at");`);

    this.addSql(`create table "public_info_request_points" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "request_id" uuid not null, "position" int not null, "text" text not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "public_info_request_points" add constraint "public_info_request_points_position_unique" unique ("request_id", "position");`);

    this.addSql(`create table "public_info_response_drafts" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "request_id" uuid not null, "version" int not null, "letter_type" text not null, "status" text not null default 'draft', "paragraphs" jsonb not null, "attachment_list" jsonb null, "letter_options" jsonb null, "generated_by" text not null default 'template', "exported_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "public_info_response_drafts" add constraint "public_info_response_drafts_version_unique" unique ("request_id", "version");`);

    this.addSql(`create table "public_info_settings" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "deadline_mode" text not null default 'calendar', "internal_due_offset_working_days" int not null default 5, "clarification_days" int not null default 7, "similarity_threshold" real not null default 0.2, "similarity_window_months" int not null default 24, "extra_holidays" jsonb null, "public_officials" jsonb null, "letterhead" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "public_info_settings" add constraint "public_info_settings_scope_unique" unique ("organization_id", "tenant_id");`);
  }

}
