import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { APP_CONFIG } from '../config/appConfig';
import {
  recordAppOpenResponseSchema,
  registerDeviceResponseSchema,
} from '../shared/engagementSchema';
import type {
  AppOpenSource,
  ClientPlatform,
  RecordAppOpenRequest,
  RegisterDeviceRequest,
} from '../types/engagement';
import { getPushRegistrationSnapshot } from './notifications';

const INSTALLATION_ID_KEY = '@soaek-bank/installation-id-v1';

function isPlaceholderBaseUrl(url: string) {
  return !/^https?:\/\//i.test(url) || url.includes('example.com');
}

function normalizePlatform(): ClientPlatform {
  if (Platform.OS === 'android' || Platform.OS === 'ios' || Platform.OS === 'web') {
    return Platform.OS;
  }

  return 'unknown';
}

function buildRequestTimeoutSignal() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, APP_CONFIG.activityRequestTimeoutMs);

  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timeoutId);
    },
  };
}

async function getInstallationId() {
  const cachedValue = await AsyncStorage.getItem(INSTALLATION_ID_KEY);

  if (cachedValue) {
    return cachedValue;
  }

  const nextValue = `install_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  await AsyncStorage.setItem(INSTALLATION_ID_KEY, nextValue);
  return nextValue;
}

function getDeviceLabel() {
  const parts = [Device.brand, Device.modelName].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

function getAppVersion() {
  return Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? null;
}

async function postJson<TResponse>(
  path: string,
  payload: unknown,
  validate: (value: unknown) => TResponse,
) {
  if (isPlaceholderBaseUrl(APP_CONFIG.appApiBaseUrl)) {
    return null;
  }

  const timeout = buildRequestTimeoutSignal();

  try {
    const response = await fetch(`${APP_CONFIG.appApiBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      signal: timeout.signal,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const rawValue = await response.json();
    return validate(rawValue);
  } finally {
    timeout.clear();
  }
}

export async function registerCurrentDevice(customerExternalId: string | null = null) {
  const installationId = await getInstallationId();
  const pushRegistration = await getPushRegistrationSnapshot().catch(() => ({
    expoPushToken: null,
    projectId: null,
    permissionGranted: false,
  }));

  const payload: RegisterDeviceRequest = {
    installationId,
    customerExternalId,
    platform: normalizePlatform(),
    appVersion: getAppVersion(),
    expoPushToken: pushRegistration.expoPushToken,
    pushPermissionGranted: pushRegistration.permissionGranted,
    deviceLabel: getDeviceLabel(),
    deviceOsVersion: Device.osVersion ?? null,
  };

  return await postJson('/api/device/register', payload, (value) =>
    registerDeviceResponseSchema.parse(value),
  );
}

export async function recordCurrentAppOpen(
  source: AppOpenSource,
  customerExternalId: string | null = null,
) {
  const installationId = await getInstallationId();
  const payload: RecordAppOpenRequest = {
    installationId,
    customerExternalId,
    openedAt: new Date().toISOString(),
    source,
    appVersion: getAppVersion(),
  };

  return await postJson('/api/app-open', payload, (value) =>
    recordAppOpenResponseSchema.parse(value),
  );
}
