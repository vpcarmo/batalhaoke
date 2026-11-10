export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      account_billing_periods: {
        Row: {
          account_id: string
          created_at: string
          ends_at: string
          id: string
          included_executions: number
          starts_at: string
          subscription_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          ends_at: string
          id?: string
          included_executions: number
          starts_at: string
          subscription_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          included_executions?: number
          starts_at?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_billing_periods_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_billing_periods_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "account_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      account_members: {
        Row: {
          account_id: string
          created_at: string
          id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_members_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      account_subscriptions: {
        Row: {
          account_id: string
          cancellation_requested_at: string | null
          cancelled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          delinquent_since: string | null
          external_id: string | null
          external_plan_id: string | null
          grace_ends_at: string | null
          id: string
          last_payment_id: string | null
          next_renewal_at: string | null
          payment_status: string | null
          pending_plan_id: string | null
          pending_plan_version: number | null
          plan_id: string
          plan_snapshot: Json
          plan_version: number
          provider: string
          status: string
          suspended_at: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          cancellation_requested_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          delinquent_since?: string | null
          external_id?: string | null
          external_plan_id?: string | null
          grace_ends_at?: string | null
          id?: string
          last_payment_id?: string | null
          next_renewal_at?: string | null
          payment_status?: string | null
          pending_plan_id?: string | null
          pending_plan_version?: number | null
          plan_id: string
          plan_snapshot: Json
          plan_version: number
          provider?: string
          status: string
          suspended_at?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          cancellation_requested_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          delinquent_since?: string | null
          external_id?: string | null
          external_plan_id?: string | null
          grace_ends_at?: string | null
          id?: string
          last_payment_id?: string | null
          next_renewal_at?: string | null
          payment_status?: string | null
          pending_plan_id?: string | null
          pending_plan_version?: number | null
          plan_id?: string
          plan_snapshot?: Json
          plan_version?: number
          provider?: string
          status?: string
          suspended_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_subscriptions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_subscriptions_pending_plan_id_fkey"
            columns: ["pending_plan_id"]
            isOneToOne: false
            referencedRelation: "commercial_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "commercial_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      account_trials: {
        Row: {
          account_id: string
          created_at: string
          ends_at: string
          expired_at: string | null
          granted_by: string | null
          id: string
          reason: string | null
          revoked_at: string | null
          starts_at: string
          status: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          ends_at: string
          expired_at?: string | null
          granted_by?: string | null
          id?: string
          reason?: string | null
          revoked_at?: string | null
          starts_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          ends_at?: string
          expired_at?: string | null
          granted_by?: string | null
          id?: string
          reason?: string | null
          revoked_at?: string | null
          starts_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_trials_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      account_usage_ledger: {
        Row: {
          account_id: string
          billing_period_id: string | null
          consumed_at: string
          created_at: string
          entry_type: string
          execution_quantity: number
          id: string
          idempotency_key: string
          performance_id: string
          rule_metadata: Json
          session_id: string
          venue_id: string
        }
        Insert: {
          account_id: string
          billing_period_id?: string | null
          consumed_at?: string
          created_at?: string
          entry_type: string
          execution_quantity: number
          id?: string
          idempotency_key: string
          performance_id: string
          rule_metadata?: Json
          session_id: string
          venue_id: string
        }
        Update: {
          account_id?: string
          billing_period_id?: string | null
          consumed_at?: string
          created_at?: string
          entry_type?: string
          execution_quantity?: number
          id?: string
          idempotency_key?: string
          performance_id?: string
          rule_metadata?: Json
          session_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_usage_ledger_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_usage_ledger_billing_period_id_fkey"
            columns: ["billing_period_id"]
            isOneToOne: false
            referencedRelation: "account_billing_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_usage_ledger_performance_id_fkey"
            columns: ["performance_id"]
            isOneToOne: false
            referencedRelation: "performances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_usage_ledger_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_usage_ledger_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          created_at: string
          id: string
          name: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      championship_entries: {
        Row: {
          admin_notes: string | null
          championship_id: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          group_letter: string | null
          id: string
          name: string
          participant_id: string | null
          seed_number: number | null
          stage_name: string | null
          status: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          championship_id: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          group_letter?: string | null
          id?: string
          name: string
          participant_id?: string | null
          seed_number?: number | null
          stage_name?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          championship_id?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          group_letter?: string | null
          id?: string
          name?: string
          participant_id?: string | null
          seed_number?: number | null
          stage_name?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "championship_entries_championship_id_fkey"
            columns: ["championship_id"]
            isOneToOne: false
            referencedRelation: "championships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "championship_entries_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      championship_entry_songs: {
        Row: {
          created_at: string
          entry_id: string
          id: string
          playback_source_id: string
          song_order: number
          song_type: string
        }
        Insert: {
          created_at?: string
          entry_id: string
          id?: string
          playback_source_id: string
          song_order: number
          song_type: string
        }
        Update: {
          created_at?: string
          entry_id?: string
          id?: string
          playback_source_id?: string
          song_order?: number
          song_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "championship_entry_songs_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "championship_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "championship_entry_songs_playback_source_id_fkey"
            columns: ["playback_source_id"]
            isOneToOne: false
            referencedRelation: "playback_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      championship_group_stage_tie_decisions: {
        Row: {
          championship_id: string
          chosen_order: string[]
          created_at: string
          criteria_applied: string[]
          group_letter: string | null
          id: string
          operator_user_id: string
          rationale: string | null
          tied_entry_ids: string[]
          updated_at: string
        }
        Insert: {
          championship_id: string
          chosen_order: string[]
          created_at?: string
          criteria_applied: string[]
          group_letter?: string | null
          id?: string
          operator_user_id: string
          rationale?: string | null
          tied_entry_ids: string[]
          updated_at?: string
        }
        Update: {
          championship_id?: string
          chosen_order?: string[]
          created_at?: string
          criteria_applied?: string[]
          group_letter?: string | null
          id?: string
          operator_user_id?: string
          rationale?: string | null
          tied_entry_ids?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "championship_group_stage_tie_decisions_championship_id_fkey"
            columns: ["championship_id"]
            isOneToOne: false
            referencedRelation: "championships"
            referencedColumns: ["id"]
          },
        ]
      }
      championship_match_resolution_audit: {
        Row: {
          created_at: string
          id: string
          match_id: string
          operator_user_id: string
          original_result: string
          reason: string
          votes_a: number
          votes_b: number
          winner_entry_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          match_id: string
          operator_user_id: string
          original_result: string
          reason: string
          votes_a: number
          votes_b: number
          winner_entry_id: string
        }
        Update: {
          created_at?: string
          id?: string
          match_id?: string
          operator_user_id?: string
          original_result?: string
          reason?: string
          votes_a?: number
          votes_b?: number
          winner_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "championship_match_resolution_audit_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: true
            referencedRelation: "championship_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "championship_match_resolution_audit_winner_entry_id_fkey"
            columns: ["winner_entry_id"]
            isOneToOne: false
            referencedRelation: "championship_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      championship_match_votes: {
        Row: {
          chosen_entry_id: string
          created_at: string
          id: string
          match_id: string
          voter_session_id: string
        }
        Insert: {
          chosen_entry_id: string
          created_at?: string
          id?: string
          match_id: string
          voter_session_id: string
        }
        Update: {
          chosen_entry_id?: string
          created_at?: string
          id?: string
          match_id?: string
          voter_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "championship_match_votes_chosen_entry_id_fkey"
            columns: ["chosen_entry_id"]
            isOneToOne: false
            referencedRelation: "championship_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "championship_match_votes_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "championship_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "championship_match_votes_voter_session_id_fkey"
            columns: ["voter_session_id"]
            isOneToOne: false
            referencedRelation: "voter_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      championship_match_wo_audit: {
        Row: {
          created_at: string
          id: string
          match_id: string
          operator_user_id: string
          reason: string
          winner_entry_id: string
          withdrawn_entry_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          match_id: string
          operator_user_id: string
          reason: string
          winner_entry_id: string
          withdrawn_entry_id: string
        }
        Update: {
          created_at?: string
          id?: string
          match_id?: string
          operator_user_id?: string
          reason?: string
          winner_entry_id?: string
          withdrawn_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "championship_match_wo_audit_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: true
            referencedRelation: "championship_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "championship_match_wo_audit_winner_entry_id_fkey"
            columns: ["winner_entry_id"]
            isOneToOne: false
            referencedRelation: "championship_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "championship_match_wo_audit_withdrawn_entry_id_fkey"
            columns: ["withdrawn_entry_id"]
            isOneToOne: false
            referencedRelation: "championship_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      championship_matches: {
        Row: {
          championship_id: string
          created_at: string
          entry_a_id: string | null
          entry_b_id: string | null
          id: string
          match_number: number
          performance_a_id: string | null
          performance_b_id: string | null
          stage: string
          status: string
          updated_at: string
          voting_ends_at: string | null
          voting_status: string
          winner_entry_id: string | null
        }
        Insert: {
          championship_id: string
          created_at?: string
          entry_a_id?: string | null
          entry_b_id?: string | null
          id?: string
          match_number: number
          performance_a_id?: string | null
          performance_b_id?: string | null
          stage: string
          status?: string
          updated_at?: string
          voting_ends_at?: string | null
          voting_status?: string
          winner_entry_id?: string | null
        }
        Update: {
          championship_id?: string
          created_at?: string
          entry_a_id?: string | null
          entry_b_id?: string | null
          id?: string
          match_number?: number
          performance_a_id?: string | null
          performance_b_id?: string | null
          stage?: string
          status?: string
          updated_at?: string
          voting_ends_at?: string | null
          voting_status?: string
          winner_entry_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "championship_matches_championship_id_fkey"
            columns: ["championship_id"]
            isOneToOne: false
            referencedRelation: "championships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "championship_matches_entry_a_id_fkey"
            columns: ["entry_a_id"]
            isOneToOne: false
            referencedRelation: "championship_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "championship_matches_entry_b_id_fkey"
            columns: ["entry_b_id"]
            isOneToOne: false
            referencedRelation: "championship_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "championship_matches_performance_a_id_fkey"
            columns: ["performance_a_id"]
            isOneToOne: false
            referencedRelation: "performances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "championship_matches_performance_b_id_fkey"
            columns: ["performance_b_id"]
            isOneToOne: false
            referencedRelation: "performances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "championship_matches_winner_entry_id_fkey"
            columns: ["winner_entry_id"]
            isOneToOne: false
            referencedRelation: "championship_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      championships: {
        Row: {
          created_at: string
          event_starts_at: string | null
          fee_info: string | null
          format: number
          id: string
          location: string | null
          prize_info: string | null
          registration_deadline: string | null
          rules: string | null
          status: string
          title: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          event_starts_at?: string | null
          fee_info?: string | null
          format: number
          id?: string
          location?: string | null
          prize_info?: string | null
          registration_deadline?: string | null
          rules?: string | null
          status?: string
          title: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          created_at?: string
          event_starts_at?: string | null
          fee_info?: string | null
          format?: number
          id?: string
          location?: string | null
          prize_info?: string | null
          registration_deadline?: string | null
          rules?: string | null
          status?: string
          title?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "championships_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_account_jobs: {
        Row: {
          account_id: string
          created_at: string
          detail: string | null
          id: string
          outcome: string
          run_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          detail?: string | null
          id?: string
          outcome: string
          run_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          detail?: string | null
          id?: string
          outcome?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_account_jobs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_account_jobs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "commercial_job_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_account_settings: {
        Row: {
          account_id: string
          billing_enabled: boolean
          updated_at: string
          venue_limit_override: number | null
        }
        Insert: {
          account_id: string
          billing_enabled?: boolean
          updated_at?: string
          venue_limit_override?: number | null
        }
        Update: {
          account_id?: string
          billing_enabled?: boolean
          updated_at?: string
          venue_limit_override?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "commercial_account_settings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_audit_log: {
        Row: {
          account_id: string | null
          actor_user_id: string | null
          after_state: Json | null
          before_state: Json | null
          created_at: string
          id: string
          operation: string
          reason: string | null
        }
        Insert: {
          account_id?: string | null
          actor_user_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          id?: string
          operation: string
          reason?: string | null
        }
        Update: {
          account_id?: string | null
          actor_user_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          id?: string
          operation?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commercial_audit_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_chargeback_debts: {
        Row: {
          account_id: string
          adjustment_id: string
          created_at: string
          id: string
          original_cents: number
          payment_id: string
          settled_at: string | null
          settled_cents: number
          status: string
          unrecovered_cents: number
        }
        Insert: {
          account_id: string
          adjustment_id: string
          created_at?: string
          id?: string
          original_cents: number
          payment_id: string
          settled_at?: string | null
          settled_cents?: number
          status?: string
          unrecovered_cents: number
        }
        Update: {
          account_id?: string
          adjustment_id?: string
          created_at?: string
          id?: string
          original_cents?: number
          payment_id?: string
          settled_at?: string | null
          settled_cents?: number
          status?: string
          unrecovered_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "commercial_chargeback_debts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_credit_allocations: {
        Row: {
          created_at: string
          purchase_entry_id: string
          quantity: number
          usage_entry_id: string
        }
        Insert: {
          created_at?: string
          purchase_entry_id: string
          quantity: number
          usage_entry_id: string
        }
        Update: {
          created_at?: string
          purchase_entry_id?: string
          quantity?: number
          usage_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_credit_allocations_purchase_entry_id_fkey"
            columns: ["purchase_entry_id"]
            isOneToOne: false
            referencedRelation: "credit_wallet_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_credit_allocations_usage_entry_id_fkey"
            columns: ["usage_entry_id"]
            isOneToOne: false
            referencedRelation: "credit_wallet_ledger"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_cron_lock: {
        Row: {
          expires_at: string
          id: boolean
          token: string
        }
        Insert: {
          expires_at: string
          id?: boolean
          token: string
        }
        Update: {
          expires_at?: string
          id?: boolean
          token?: string
        }
        Relationships: []
      }
      commercial_job_runs: {
        Row: {
          failed: number
          finished_at: string | null
          id: string
          job: string
          outcomes: Json
          selected: number
          started_at: string
          succeeded: number
        }
        Insert: {
          failed?: number
          finished_at?: string | null
          id?: string
          job: string
          outcomes?: Json
          selected?: number
          started_at?: string
          succeeded?: number
        }
        Update: {
          failed?: number
          finished_at?: string | null
          id?: string
          job?: string
          outcomes?: Json
          selected?: number
          started_at?: string
          succeeded?: number
        }
        Relationships: []
      }
      commercial_lifecycle_verifications: {
        Row: {
          checked_at: string
          remote_status: string
          subscription_id: string
        }
        Insert: {
          checked_at?: string
          remote_status: string
          subscription_id: string
        }
        Update: {
          checked_at?: string
          remote_status?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_lifecycle_verifications_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: true
            referencedRelation: "account_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_orders: {
        Row: {
          account_id: string
          amount_cents: number
          created_at: string
          credit_expires_at: string | null
          credits: number
          external_payment_id: string | null
          external_preference_id: string | null
          external_reference: string
          id: string
          kind: string
          pack_id: string | null
          paid_at: string | null
          provider: string
          status: string
          subscription_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          amount_cents: number
          created_at?: string
          credit_expires_at?: string | null
          credits?: number
          external_payment_id?: string | null
          external_preference_id?: string | null
          external_reference: string
          id?: string
          kind: string
          pack_id?: string | null
          paid_at?: string | null
          provider?: string
          status?: string
          subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount_cents?: number
          created_at?: string
          credit_expires_at?: string | null
          credits?: number
          external_payment_id?: string | null
          external_preference_id?: string | null
          external_reference?: string
          id?: string
          kind?: string
          pack_id?: string | null
          paid_at?: string | null
          provider?: string
          status?: string
          subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_orders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_orders_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "credit_packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_orders_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "account_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_payment_adjustments: {
        Row: {
          account_id: string
          adjustment_id: string
          amount_cents: number
          created_at: string
          currency: string
          id: string
          kind: string
          order_id: string | null
          payment_id: string
          status: string
          subscription_id: string | null
          unrecovered_cents: number
        }
        Insert: {
          account_id: string
          adjustment_id: string
          amount_cents: number
          created_at?: string
          currency?: string
          id?: string
          kind: string
          order_id?: string | null
          payment_id: string
          status: string
          subscription_id?: string | null
          unrecovered_cents?: number
        }
        Update: {
          account_id?: string
          adjustment_id?: string
          amount_cents?: number
          created_at?: string
          currency?: string
          id?: string
          kind?: string
          order_id?: string | null
          payment_id?: string
          status?: string
          subscription_id?: string | null
          unrecovered_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "commercial_payment_adjustments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_payment_adjustments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "commercial_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_payment_adjustments_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "account_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_plan_versions: {
        Row: {
          created_at: string
          id: string
          plan_id: string
          snapshot: Json
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          plan_id: string
          snapshot: Json
          version: number
        }
        Update: {
          created_at?: string
          id?: string
          plan_id?: string
          snapshot?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "commercial_plan_versions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "commercial_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_plans: {
        Row: {
          account_type: string
          code: string
          created_at: string
          description: string
          display_order: number
          id: string
          included_executions: number
          monthly_price_cents: number
          name: string
          status: string
          updated_at: string
          venue_limit: number
          version: number
        }
        Insert: {
          account_type: string
          code: string
          created_at?: string
          description?: string
          display_order?: number
          id?: string
          included_executions?: number
          monthly_price_cents?: number
          name: string
          status?: string
          updated_at?: string
          venue_limit?: number
          version?: number
        }
        Update: {
          account_type?: string
          code?: string
          created_at?: string
          description?: string
          display_order?: number
          id?: string
          included_executions?: number
          monthly_price_cents?: number
          name?: string
          status?: string
          updated_at?: string
          venue_limit?: number
          version?: number
        }
        Relationships: []
      }
      commercial_provider_resource_locks: {
        Row: {
          acquired_at: string
          event_id: string | null
          resource_key: string
        }
        Insert: {
          acquired_at?: string
          event_id?: string | null
          resource_key: string
        }
        Update: {
          acquired_at?: string
          event_id?: string | null
          resource_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_provider_resource_locks_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "mercado_pago_events"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_reconciliation_log: {
        Row: {
          actor_user_id: string
          created_at: string
          detail: string | null
          id: string
          order_id: string | null
          outcome: string
          run_id: string
          subscription_id: string | null
        }
        Insert: {
          actor_user_id: string
          created_at?: string
          detail?: string | null
          id?: string
          order_id?: string | null
          outcome: string
          run_id: string
          subscription_id?: string | null
        }
        Update: {
          actor_user_id?: string
          created_at?: string
          detail?: string | null
          id?: string
          order_id?: string | null
          outcome?: string
          run_id?: string
          subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commercial_reconciliation_log_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "commercial_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_reconciliation_log_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "account_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_settings: {
        Row: {
          billing_enabled: boolean
          delinquency_grace_days: number
          id: boolean
          trial_duration_days: number | null
          trial_venue_limit: number
          updated_at: string
        }
        Insert: {
          billing_enabled?: boolean
          delinquency_grace_days?: number
          id?: boolean
          trial_duration_days?: number | null
          trial_venue_limit?: number
          updated_at?: string
        }
        Update: {
          billing_enabled?: boolean
          delinquency_grace_days?: number
          id?: boolean
          trial_duration_days?: number | null
          trial_venue_limit?: number
          updated_at?: string
        }
        Relationships: []
      }
      commercial_subscription_payments: {
        Row: {
          amount_cents: number | null
          created_at: string
          disputed: boolean
          id: string
          paid_at: string | null
          provider_payment_id: string
          refunded_cents: number
          status: string
          subscription_id: string
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          disputed?: boolean
          id?: string
          paid_at?: string | null
          provider_payment_id: string
          refunded_cents?: number
          status: string
          subscription_id: string
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          disputed?: boolean
          id?: string
          paid_at?: string | null
          provider_payment_id?: string
          refunded_cents?: number
          status?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_subscription_payments_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "account_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_trial_history: {
        Row: {
          account_id: string
          actor_user_id: string | null
          created_at: string
          ends_at: string | null
          id: string
          operation: string
          reason: string
          starts_at: string | null
          trial_id: string | null
        }
        Insert: {
          account_id: string
          actor_user_id?: string | null
          created_at?: string
          ends_at?: string | null
          id?: string
          operation: string
          reason: string
          starts_at?: string | null
          trial_id?: string | null
        }
        Update: {
          account_id?: string
          actor_user_id?: string | null
          created_at?: string
          ends_at?: string | null
          id?: string
          operation?: string
          reason?: string
          starts_at?: string | null
          trial_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commercial_trial_history_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_trial_history_trial_id_fkey"
            columns: ["trial_id"]
            isOneToOne: false
            referencedRelation: "account_trials"
            referencedColumns: ["id"]
          },
        ]
      }
      controllers: {
        Row: {
          created_at: string
          device_code: string
          firmware_version: string | null
          id: string
          last_seen: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          device_code: string
          firmware_version?: string | null
          id?: string
          last_seen?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          device_code?: string
          firmware_version?: string | null
          id?: string
          last_seen?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      credit_packs: {
        Row: {
          active: boolean
          created_at: string
          credits: number
          description: string
          display_order: number
          id: string
          name: string
          price_cents: number
          updated_at: string
          validity_days: number | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          credits: number
          description?: string
          display_order?: number
          id?: string
          name: string
          price_cents: number
          updated_at?: string
          validity_days?: number | null
        }
        Update: {
          active?: boolean
          created_at?: string
          credits?: number
          description?: string
          display_order?: number
          id?: string
          name?: string
          price_cents?: number
          updated_at?: string
          validity_days?: number | null
        }
        Relationships: []
      }
      credit_wallet_ledger: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          entry_type: string
          expires_at: string | null
          id: string
          idempotency_key: string
          order_id: string | null
          performance_id: string | null
          quantity: number
          reason: string | null
          source: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          entry_type: string
          expires_at?: string | null
          id?: string
          idempotency_key: string
          order_id?: string | null
          performance_id?: string | null
          quantity: number
          reason?: string | null
          source: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          entry_type?: string
          expires_at?: string | null
          id?: string
          idempotency_key?: string
          order_id?: string | null
          performance_id?: string | null
          quantity?: number
          reason?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_wallet_ledger_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_wallet_ledger_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "commercial_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_wallet_ledger_performance_id_fkey"
            columns: ["performance_id"]
            isOneToOne: false
            referencedRelation: "performances"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_reservations: {
        Row: {
          account_id: string
          billing_period_id: string | null
          performance_id: string
          reserved_at: string
          resolved_at: string | null
          source: string
          status: string
        }
        Insert: {
          account_id: string
          billing_period_id?: string | null
          performance_id: string
          reserved_at?: string
          resolved_at?: string | null
          source: string
          status?: string
        }
        Update: {
          account_id?: string
          billing_period_id?: string | null
          performance_id?: string
          reserved_at?: string
          resolved_at?: string | null
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_reservations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_reservations_billing_period_id_fkey"
            columns: ["billing_period_id"]
            isOneToOne: false
            referencedRelation: "account_billing_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_reservations_performance_id_fkey"
            columns: ["performance_id"]
            isOneToOne: true
            referencedRelation: "performances"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          created_at: string
          id: string
          participant_a_id: string
          participant_b_id: string
          session_id: string
          status: string
          updated_at: string
          voting_ends_at: string | null
          voting_status: string
          winner_participant_id: string | null
          withdrawn_slot: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          participant_a_id: string
          participant_b_id: string
          session_id: string
          status?: string
          updated_at?: string
          voting_ends_at?: string | null
          voting_status?: string
          winner_participant_id?: string | null
          withdrawn_slot?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          participant_a_id?: string
          participant_b_id?: string
          session_id?: string
          status?: string
          updated_at?: string
          voting_ends_at?: string | null
          voting_status?: string
          winner_participant_id?: string | null
          withdrawn_slot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_participant_a_session_fkey"
            columns: ["session_id", "participant_a_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["session_id", "id"]
          },
          {
            foreignKeyName: "matches_participant_b_session_fkey"
            columns: ["session_id", "participant_b_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["session_id", "id"]
          },
          {
            foreignKeyName: "matches_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      mercado_pago_event_attempts: {
        Row: {
          attempt: number
          created_at: string
          error: string | null
          event_id: string
          id: string
          initiated_by: string | null
          result: Json | null
          status: string
        }
        Insert: {
          attempt: number
          created_at?: string
          error?: string | null
          event_id: string
          id?: string
          initiated_by?: string | null
          result?: Json | null
          status: string
        }
        Update: {
          attempt?: number
          created_at?: string
          error?: string | null
          event_id?: string
          id?: string
          initiated_by?: string | null
          result?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "mercado_pago_event_attempts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "mercado_pago_events"
            referencedColumns: ["id"]
          },
        ]
      }
      mercado_pago_events: {
        Row: {
          account_id: string | null
          attempts: number
          claim_token: string | null
          claimed_at: string | null
          event_id: string | null
          id: string
          last_attempt_at: string | null
          last_error: string | null
          payload: Json | null
          processed_at: string | null
          processing_error: string | null
          received_at: string
          reprocess_requested_at: string | null
          reprocess_requested_by: string | null
          reprocessed_at: string | null
          resource_id: string
          signature_valid: boolean
          status: string
          topic: string | null
        }
        Insert: {
          account_id?: string | null
          attempts?: number
          claim_token?: string | null
          claimed_at?: string | null
          event_id?: string | null
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          payload?: Json | null
          processed_at?: string | null
          processing_error?: string | null
          received_at?: string
          reprocess_requested_at?: string | null
          reprocess_requested_by?: string | null
          reprocessed_at?: string | null
          resource_id: string
          signature_valid: boolean
          status?: string
          topic?: string | null
        }
        Update: {
          account_id?: string | null
          attempts?: number
          claim_token?: string | null
          claimed_at?: string | null
          event_id?: string | null
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          payload?: Json | null
          processed_at?: string | null
          processing_error?: string | null
          received_at?: string
          reprocess_requested_at?: string | null
          reprocess_requested_by?: string | null
          reprocessed_at?: string | null
          resource_id?: string
          signature_valid?: boolean
          status?: string
          topic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mercado_pago_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      participants: {
        Row: {
          created_at: string
          id: string
          name: string
          participant_number: number
          session_id: string
          stage_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          participant_number: number
          session_id: string
          stage_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          participant_number?: number
          session_id?: string
          stage_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "participants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_measurements: {
        Row: {
          account_id: string | null
          accumulated_ms: number
          created_at: string
          finalized_at: string | null
          last_position_seconds: number | null
          last_received_at: string | null
          last_sequence: number
          last_state: string | null
          lease_device_id: string | null
          lease_expires_at: string | null
          lease_kind: string
          performance_id: string
          player_epoch_id: string | null
          player_instance_id: string | null
          provider: string
          qualified_at: string | null
          session_id: string
          status: string
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          account_id?: string | null
          accumulated_ms?: number
          created_at?: string
          finalized_at?: string | null
          last_position_seconds?: number | null
          last_received_at?: string | null
          last_sequence?: number
          last_state?: string | null
          lease_device_id?: string | null
          lease_expires_at?: string | null
          lease_kind?: string
          performance_id: string
          player_epoch_id?: string | null
          player_instance_id?: string | null
          provider: string
          qualified_at?: string | null
          session_id: string
          status?: string
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          account_id?: string | null
          accumulated_ms?: number
          created_at?: string
          finalized_at?: string | null
          last_position_seconds?: number | null
          last_received_at?: string | null
          last_sequence?: number
          last_state?: string | null
          lease_device_id?: string | null
          lease_expires_at?: string | null
          lease_kind?: string
          performance_id?: string
          player_epoch_id?: string | null
          player_instance_id?: string | null
          provider?: string
          qualified_at?: string | null
          session_id?: string
          status?: string
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "performance_measurements_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_measurements_lease_device_id_fkey"
            columns: ["lease_device_id"]
            isOneToOne: false
            referencedRelation: "venue_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_measurements_performance_id_fkey"
            columns: ["performance_id"]
            isOneToOne: true
            referencedRelation: "performances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_measurements_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_measurements_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      performances: {
        Row: {
          created_at: string
          dislike_count: number
          ended_at: string | null
          id: string
          like_count: number
          match_id: string | null
          match_slot: string | null
          participant_id: string
          playback_source_id: string
          session_id: string
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          dislike_count?: number
          ended_at?: string | null
          id?: string
          like_count?: number
          match_id?: string | null
          match_slot?: string | null
          participant_id: string
          playback_source_id: string
          session_id: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          dislike_count?: number
          ended_at?: string | null
          id?: string
          like_count?: number
          match_id?: string | null
          match_slot?: string | null
          participant_id?: string
          playback_source_id?: string
          session_id?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "performances_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performances_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performances_playback_source_id_fkey"
            columns: ["playback_source_id"]
            isOneToOne: false
            referencedRelation: "playback_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performances_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      playback_sources: {
        Row: {
          channel_name: string | null
          created_at: string
          duration: string | null
          external_id: string
          id: string
          metadata: Json
          provider: string
          thumbnail_url: string | null
          title: string
        }
        Insert: {
          channel_name?: string | null
          created_at?: string
          duration?: string | null
          external_id: string
          id?: string
          metadata?: Json
          provider: string
          thumbnail_url?: string | null
          title: string
        }
        Update: {
          channel_name?: string | null
          created_at?: string
          duration?: string | null
          external_id?: string
          id?: string
          metadata?: Json
          provider?: string
          thumbnail_url?: string | null
          title?: string
        }
        Relationships: []
      }
      provider_api_calls: {
        Row: {
          cached: boolean
          created_at: string
          endpoint: string
          error: string | null
          id: string
          ok: boolean
          provider: string
          query: string | null
        }
        Insert: {
          cached?: boolean
          created_at?: string
          endpoint: string
          error?: string | null
          id?: string
          ok?: boolean
          provider: string
          query?: string | null
        }
        Update: {
          cached?: boolean
          created_at?: string
          endpoint?: string
          error?: string | null
          id?: string
          ok?: boolean
          provider?: string
          query?: string | null
        }
        Relationships: []
      }
      sessions: {
        Row: {
          championship_id: string | null
          created_at: string
          ended_at: string | null
          id: string
          name: string
          public_code: string
          session_type: string
          show_qr_on_tv: boolean
          started_at: string | null
          status: string
          tv_enabled: boolean
          updated_at: string
          venue_id: string | null
          voting_mode: string
          x1_voting_mode: string
        }
        Insert: {
          championship_id?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          name: string
          public_code?: string
          session_type?: string
          show_qr_on_tv?: boolean
          started_at?: string | null
          status?: string
          tv_enabled?: boolean
          updated_at?: string
          venue_id?: string | null
          voting_mode?: string
          x1_voting_mode?: string
        }
        Update: {
          championship_id?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          name?: string
          public_code?: string
          session_type?: string
          show_qr_on_tv?: boolean
          started_at?: string | null
          status?: string
          tv_enabled?: boolean
          updated_at?: string
          venue_id?: string | null
          voting_mode?: string
          x1_voting_mode?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_championship_id_fkey"
            columns: ["championship_id"]
            isOneToOne: false
            referencedRelation: "championships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_devices: {
        Row: {
          created_at: string
          device_token_hash: string
          id: string
          last_seen_at: string | null
          name: string | null
          pairing_code_hash: string | null
          pairing_expires_at: string | null
          status: string
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          created_at?: string
          device_token_hash: string
          id?: string
          last_seen_at?: string | null
          name?: string | null
          pairing_code_hash?: string | null
          pairing_expires_at?: string | null
          status?: string
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          created_at?: string
          device_token_hash?: string
          id?: string
          last_seen_at?: string | null
          name?: string | null
          pairing_code_hash?: string | null
          pairing_expires_at?: string | null
          status?: string
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venue_devices_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_favorite_songs: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          playback_source_id: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          playback_source_id: string
          venue_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          playback_source_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_favorite_songs_playback_source_id_fkey"
            columns: ["playback_source_id"]
            isOneToOne: false
            referencedRelation: "playback_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_favorite_songs_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_operator_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          cancelled_at: string | null
          created_at: string
          delivery_claim_id: string | null
          delivery_claimed_at: string | null
          delivery_lease_until: string | null
          delivery_state: string
          email_normalized: string
          expires_at: string
          id: string
          invited_by: string
          role: string
          sent_at: string | null
          status: string
          token_hash: string
          venue_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          cancelled_at?: string | null
          created_at?: string
          delivery_claim_id?: string | null
          delivery_claimed_at?: string | null
          delivery_lease_until?: string | null
          delivery_state?: string
          email_normalized: string
          expires_at: string
          id?: string
          invited_by: string
          role?: string
          sent_at?: string | null
          status?: string
          token_hash: string
          venue_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          cancelled_at?: string | null
          created_at?: string
          delivery_claim_id?: string | null
          delivery_claimed_at?: string | null
          delivery_lease_until?: string | null
          delivery_state?: string
          email_normalized?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: string
          sent_at?: string | null
          status?: string
          token_hash?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_operator_invites_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_operators: {
        Row: {
          created_at: string
          id: string
          role: string
          updated_at: string
          user_id: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: string
          updated_at?: string
          user_id: string
          venue_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          updated_at?: string
          user_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_operators_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          account_id: string | null
          created_at: string
          id: string
          name: string
          slug: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          id?: string
          name: string
          slug?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          id?: string
          name?: string
          slug?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "venues_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      voter_sessions: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string
          session_id: string
          voter_token_hash: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string
          session_id: string
          voter_token_hash: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string
          session_id?: string
          voter_token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "voter_sessions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      votes: {
        Row: {
          controller_id: string | null
          created_at: string
          id: string
          performance_id: string
          vote_type: string
          voter_session_id: string | null
        }
        Insert: {
          controller_id?: string | null
          created_at?: string
          id?: string
          performance_id: string
          vote_type: string
          voter_session_id?: string | null
        }
        Update: {
          controller_id?: string | null
          created_at?: string
          id?: string
          performance_id?: string
          vote_type?: string
          voter_session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "votes_controller_id_fkey"
            columns: ["controller_id"]
            isOneToOne: false
            referencedRelation: "controllers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "votes_performance_id_fkey"
            columns: ["performance_id"]
            isOneToOne: false
            referencedRelation: "performances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "votes_voter_session_id_fkey"
            columns: ["voter_session_id"]
            isOneToOne: false
            referencedRelation: "voter_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      x1_match_votes: {
        Row: {
          chosen_participant_id: string
          created_at: string
          id: string
          match_id: string
          voter_session_id: string
        }
        Insert: {
          chosen_participant_id: string
          created_at?: string
          id?: string
          match_id: string
          voter_session_id: string
        }
        Update: {
          chosen_participant_id?: string
          created_at?: string
          id?: string
          match_id?: string
          voter_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "x1_match_votes_chosen_participant_id_fkey"
            columns: ["chosen_participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "x1_match_votes_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "x1_match_votes_voter_session_id_fkey"
            columns: ["voter_session_id"]
            isOneToOne: false
            referencedRelation: "voter_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_venue_operator_invite: {
        Args: {
          p_email_normalized: string
          p_token_hash: string
          p_user_id: string
        }
        Returns: {
          role: string
          venue_id: string
        }[]
      }
      acquire_commercial_cron_lock: {
        Args: { p_token: string }
        Returns: boolean
      }
      acquire_performance_measurement:
        | {
            Args: {
              p_instance_id: string
              p_performance_id: string
              p_provider: string
            }
            Returns: {
              accumulated_ms: number
              epoch_id: string
              lease_expires_at: string
            }[]
          }
        | {
            Args: {
              p_device_id?: string
              p_instance_id: string
              p_lease_kind?: string
              p_performance_id: string
              p_provider: string
            }
            Returns: {
              accumulated_ms: number
              epoch_id: string
              lease_expires_at: string
            }[]
          }
      advance_championship_elimination: {
        Args: { p_championship_id: string; p_operator_user_id: string }
        Returns: Json
      }
      apply_commercial_payment: {
        Args: {
          p_amount_cents?: number
          p_external_reference: string
          p_paid_at?: string
          p_payment_id: string
          p_status: string
        }
        Returns: undefined
      }
      apply_commercial_reversal: {
        Args: {
          p_adjustment_id: string
          p_amount_cents: number
          p_currency: string
          p_kind: string
          p_payment_id: string
          p_status: string
        }
        Returns: Json
      }
      apply_locked_commercial_payment: {
        Args: {
          p_amount_cents: number
          p_external_reference: string
          p_paid_at: string
          p_payment_id: string
          p_status: string
          p_token: string
        }
        Returns: undefined
      }
      assert_championship_operator: {
        Args: { p_championship_id: string; p_operator_user_id: string }
        Returns: string
      }
      authorize_commercial_playback: {
        Args: { p_performance_id: string }
        Returns: boolean
      }
      cast_championship_match_vote: {
        Args: {
          p_chosen_entry_id: string
          p_match_id: string
          p_voter_token_hash: string
        }
        Returns: Json
      }
      championship_elimination_bracket_is_valid: {
        Args: {
          p_championship_id: string
          p_require_final_result?: boolean
          p_through_stage: string
        }
        Returns: boolean
      }
      championship_match_result_is_valid: {
        Args: {
          p_match: Database["public"]["Tables"]["championship_matches"]["Row"]
        }
        Returns: boolean
      }
      claim_venue_operator_invite_resend: {
        Args: {
          p_claim_id: string
          p_expires_at: string
          p_invite_id: string
          p_token_hash: string
        }
        Returns: string
      }
      close_championship_match_voting: {
        Args: { p_match_id: string; p_operator_user_id: string }
        Returns: Json
      }
      complete_championship: {
        Args: { p_championship_id: string; p_operator_user_id: string }
        Returns: Json
      }
      complete_championship_presentation: {
        Args: { p_match_id: string; p_operator_user_id: string; p_slot: string }
        Returns: Json
      }
      create_individual_venue_with_owner: {
        Args: { p_name: string; p_owner_user_id: string; p_slug: string }
        Returns: {
          account_id: string
          slug: string
          venue_id: string
        }[]
      }
      draw_championship: { Args: { p_championship_id: string }; Returns: Json }
      finalize_group_stage_and_generate_quarters: {
        Args: { p_championship_id: string; p_operator_user_id: string }
        Returns: Json
      }
      finalize_performance_measurement: {
        Args: { p_performance_id: string }
        Returns: undefined
      }
      finish_venue_operator_invite_delivery: {
        Args: {
          p_claim_id: string
          p_invite_id: string
          p_sent: boolean
          p_token_hash: string
        }
        Returns: boolean
      }
      get_championship_match_score: {
        Args: { p_match_id: string; p_operator_user_id: string }
        Returns: Json
      }
      grant_commercial_credits: {
        Args: {
          p_account_id: string
          p_actor: string
          p_idempotency_key: string
          p_quantity: number
          p_reason: string
        }
        Returns: string
      }
      grant_commercial_trial: {
        Args: {
          p_account_id: string
          p_actor: string
          p_days: number
          p_reason: string
        }
        Returns: string
      }
      link_championship_entry_participant: {
        Args: {
          p_entry_id: string
          p_operator_user_id: string
          p_participant_id: string
        }
        Returns: Json
      }
      manage_commercial_trial: {
        Args: {
          p_account_id: string
          p_actor: string
          p_ends_at: string
          p_operation: string
          p_reason: string
        }
        Returns: string
      }
      normalize_championship_tie_entry_ids: {
        Args: { p_entry_ids: string[] }
        Returns: string[]
      }
      open_championship_match_voting: {
        Args: { p_match_id: string; p_operator_user_id: string }
        Returns: Json
      }
      process_commercial_lifecycle: {
        Args: { p_limit?: number }
        Returns: Json
      }
      record_championship_match_wo: {
        Args: {
          p_match_id: string
          p_operator_user_id: string
          p_reason: string
          p_withdrawn_entry_id: string
        }
        Returns: Json
      }
      record_group_stage_tie_break: {
        Args: {
          p_championship_id: string
          p_criteria_applied: string[]
          p_decision_order: string[]
          p_group_letter: string
          p_operator_user_id: string
          p_rationale: string
          p_tied_entry_ids: string[]
        }
        Returns: Json
      }
      record_performance_heartbeat: {
        Args: {
          p_epoch_id: string
          p_instance_id: string
          p_performance_id: string
          p_position_seconds: number
          p_sequence: number
          p_state: string
        }
        Returns: {
          accepted: boolean
          accumulated_ms: number
          qualified: boolean
          reason: string
        }[]
      }
      register_championship_entry: {
        Args: {
          p_championship_id: string
          p_contact_email: string
          p_contact_phone: string
          p_name: string
          p_songs: Json
          p_stage_name: string
        }
        Returns: Json
      }
      release_commercial_cron_lock: {
        Args: { p_token: string }
        Returns: boolean
      }
      renew_commercial_cron_lock: {
        Args: { p_token: string }
        Returns: boolean
      }
      resolve_championship_match_tie: {
        Args: {
          p_match_id: string
          p_operator_user_id: string
          p_reason: string
          p_winner_entry_id: string
        }
        Returns: Json
      }
      run_locked_commercial_lifecycle: {
        Args: { p_limit?: number; p_token: string }
        Returns: Json
      }
      set_championship_match_performances: {
        Args: {
          p_match_id: string
          p_operator_user_id: string
          p_performance_a_id: string
          p_performance_b_id: string
        }
        Returns: Json
      }
      settle_commercial_chargeback_debt: {
        Args: {
          p_account_id: string
          p_actor: string
          p_amount: number
          p_reason: string
        }
        Returns: number
      }
      start_championship_match: {
        Args: { p_match_id: string; p_operator_user_id: string }
        Returns: Json
      }
      start_championship_presentation: {
        Args: { p_match_id: string; p_operator_user_id: string; p_slot: string }
        Returns: Json
      }
      write_locked_commercial_verification: {
        Args: {
          p_remote_status?: string
          p_subscription_id: string
          p_token: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
