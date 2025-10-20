/**
 * Example implementation for Supabase backend
 * This file serves as a reference for future implementation
 *
 * To use this:
 * 1. Install @supabase/supabase-js
 * 2. Rename this file to SupabaseRepository.ts
 * 3. Update the store to use this repository instead of LocalStorageRepository
 * 4. Configure Supabase client with your project credentials
 */

import type { WeekData } from '@/types'
import type { IWeekDataRepository } from './IWeekDataRepository'
// import { createClient, SupabaseClient } from '@supabase/supabase-js'

export class SupabaseRepository implements IWeekDataRepository {
  // private readonly supabase: SupabaseClient
  private readonly userId: string

  constructor(supabaseUrl: string, supabaseKey: string, userId: string) {
    // this.supabase = createClient(supabaseUrl, supabaseKey)
    this.userId = userId
  }

  async save(data: WeekData): Promise<boolean> {
    try {
      // const { error } = await this.supabase
      //   .from('week_data')
      //   .upsert({
      //     user_id: this.userId,
      //     categories: data.categories,
      //     time_blocks: data.timeBlocks,
      //     updated_at: new Date().toISOString()
      //   })
      //
      // if (error) {
      //   console.error('[SupabaseRepository] Error saving data:', error)
      //   return false
      // }
      return true
    } catch (error) {
      console.error('[SupabaseRepository] Error saving data:', error)
      return false
    }
  }

  async load(): Promise<WeekData | null> {
    try {
      // const { data, error } = await this.supabase
      //   .from('week_data')
      //   .select('categories, time_blocks')
      //   .eq('user_id', this.userId)
      //   .single()
      //
      // if (error || !data) {
      //   return null
      // }
      //
      // return {
      //   categories: data.categories,
      //   timeBlocks: data.time_blocks
      // }
      return null
    } catch (error) {
      console.error('[SupabaseRepository] Error loading data:', error)
      return null
    }
  }

  async clear(): Promise<boolean> {
    try {
      // const { error } = await this.supabase
      //   .from('week_data')
      //   .delete()
      //   .eq('user_id', this.userId)
      //
      // if (error) {
      //   console.error('[SupabaseRepository] Error clearing data:', error)
      //   return false
      // }
      return true
    } catch (error) {
      console.error('[SupabaseRepository] Error clearing data:', error)
      return false
    }
  }

  async exists(): Promise<boolean> {
    try {
      // const { data, error } = await this.supabase
      //   .from('week_data')
      //   .select('user_id')
      //   .eq('user_id', this.userId)
      //   .single()
      //
      // return !error && data !== null
      return false
    } catch (error) {
      console.error('[SupabaseRepository] Error checking existence:', error)
      return false
    }
  }
}

/**
 * Example Supabase table schema:
 *
 * CREATE TABLE week_data (
 *   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   user_id TEXT NOT NULL,
 *   categories JSONB NOT NULL,
 *   time_blocks JSONB NOT NULL,
 *   created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
 *   updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
 *   UNIQUE(user_id)
 * );
 *
 * CREATE INDEX idx_week_data_user_id ON week_data(user_id);
 */
