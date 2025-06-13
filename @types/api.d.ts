export type ReservationStatus = 'CONFIRMED' | 'CANCELLED' | 'NO_SHOW' | 'COMPLETED';

export interface Reservation {
  id: string;
  date: string; // ISO date string
  timeSlot: number; // 0-11 representing 15-min slots from 18:00
  partySize: number;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  status: ReservationStatus;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
}

export interface CreateReservationRequest {
  date: string; // ISO date string
  timeSlot: number;
  partySize: number;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export interface UpdateReservationRequest {
  partySize?: number;
  name?: string;
  phone?: string;
  email?: string;
  notes?: string;
  status?: ReservationStatus;
}

export interface TimeSlotInfo {
  slot: number;
  time: string; // Format: "18:00-18:15"
}

export interface AvailabilityResponse {
  date: string; // ISO date string
  availableSlots: TimeSlotInfo[];
}

export interface ReservationResponse {
  reservation: Reservation;
  sms?: 'sent' | 'failed';
}

export interface ApiError {
  error: string;
  message?: string;
  details?: string[];
}

export interface BusinessHours {
  id: string;
  dayOfWeek: number; // 0=Sunday, 1=Monday, etc.
  openTime: string; // "18:00"
  closeTime: string; // "28:00"
  isOpen: boolean;
}

export interface SystemSettings {
  id: string;
  maxCapacity: number;
  slotDurationMins: number;
  reservationHours: number;
  totalSlots: number;
  dateWindowStart: string; // ISO date string
  dateWindowEnd: string; // ISO date string
  updatedAt: string; // ISO date string
}

// API Response wrappers
export type GetReservationsResponse = Reservation[];
export type GetReservationResponse = Reservation;
export type CreateReservationResponse = ReservationResponse;
export type UpdateReservationResponse = Reservation;
export type GetAvailabilityResponse = AvailabilityResponse;