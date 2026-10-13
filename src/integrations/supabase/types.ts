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
          created_at: string
          id: string
          name: string
          slug: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string | null
          updated_at?: string
        }
        Relationships: []
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
      advance_championship_elimination: {
        Args: {
          p_championship_id: string
          p_operator_user_id: string
        }
        Returns: Json
      }
      cast_championship_match_vote: {
        Args: {
          p_chosen_entry_id: string
          p_match_id: string
          p_voter_token_hash: string
        }
        Returns: Json
      }
      close_championship_match_voting: {
        Args: {
          p_match_id: string
          p_operator_user_id: string
        }
        Returns: Json
      }
      complete_championship: {
        Args: {
          p_championship_id: string
          p_operator_user_id: string
        }
        Returns: Json
      }
      complete_championship_presentation: {
        Args: {
          p_match_id: string
          p_operator_user_id: string
          p_slot: string
        }
        Returns: Json
      }
      draw_championship: {
        Args: {
          p_championship_id: string
        }
        Returns: Json
      }
      get_championship_match_score: {
        Args: {
          p_match_id: string
          p_operator_user_id: string
        }
        Returns: Json
      }
      open_championship_match_voting: {
        Args: {
          p_match_id: string
          p_operator_user_id: string
        }
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
      register_championship_entry: {
        Args: {
          p_championship_id: string
          p_contact_email: string | null
          p_contact_phone: string | null
          p_name: string
          p_songs: Json
          p_stage_name: string | null
        }
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
      start_championship_match: {
        Args: {
          p_match_id: string
          p_operator_user_id: string
        }
        Returns: Json
      }
      start_championship_presentation: {
        Args: {
          p_match_id: string
          p_operator_user_id: string
          p_slot: string
        }
        Returns: Json
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
