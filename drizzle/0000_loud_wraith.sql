CREATE TABLE "messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"chat_name" text,
	"sender" text,
	"text" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"raw_date_unix" bigint,
	"embedding" vector(1536)
);
--> statement-breakpoint
CREATE INDEX "messages_embedding_hnsw_idx" ON "messages" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "messages_owner_chat_ts_idx" ON "messages" USING btree ("owner_id","chat_id","ts");