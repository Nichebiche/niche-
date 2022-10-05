import type { Adapter, WalletError } from '@solana/wallet-adapter-base';
import React, { useEffect, useRef } from 'react';

import type { ReactNode } from 'react';
import type { WalletName } from '@solana/wallet-adapter-base';
import { WalletProviderBase } from './WalletProviderBase.js';
import { useLocalStorage } from './useLocalStorage.js';
import { useMemo } from 'react';
import getEnvironment, { Environment } from './getEnvironment.js';
import {
    createDefaultAddressSelector,
    createDefaultAuthorizationResultCache,
    SolanaMobileWalletAdapter,
    SolanaMobileWalletAdapterWalletName,
} from '@solana-mobile/wallet-adapter-mobile';
import { useConnection } from './useConnection.js';
import getInferredClusterFromEndpoint from './getInferredClusterFromEndpoint.js';

export interface WalletProviderProps {
    children: ReactNode;
    wallets: Adapter[];
    autoConnect?: boolean;
    onError?: (error: WalletError) => void;
    localStorageKey?: string;
}

let _userAgent: string | null;
function getUserAgent() {
    if (_userAgent === undefined) {
        _userAgent = globalThis.navigator?.userAgent ?? null;
    }
    return _userAgent;
}

function getIsMobile(adapters: Adapter[]) {
    const userAgentString = getUserAgent();
    return getEnvironment({ adapters, userAgentString }) === Environment.MOBILE_WEB;
}

function getUriForAppIdentity() {
    const location = globalThis.location;
    if (location == null) {
        return;
    }
    return `${location.protocol}//${location.host}`;
}

export function WalletProvider({
    autoConnect,
    localStorageKey = 'walletName',
    wallets: adapters,
    ...props
}: WalletProviderProps) {
    const { connection } = useConnection();
    const mobileWalletAdapter = useMemo(() => {
        if (!getIsMobile(adapters)) {
            return null;
        }
        const existingMobileWalletAdapter = adapters.find(
            (adapter) => adapter.name === SolanaMobileWalletAdapterWalletName
        );
        if (existingMobileWalletAdapter) {
            return existingMobileWalletAdapter;
        }
        return new SolanaMobileWalletAdapter({
            addressSelector: createDefaultAddressSelector(),
            appIdentity: {
                uri: getUriForAppIdentity(),
            },
            authorizationResultCache: createDefaultAuthorizationResultCache(),
            cluster: getInferredClusterFromEndpoint(connection?.rpcEndpoint),
        });
    }, [adapters, connection?.rpcEndpoint]);
    const adaptersWithDefaultsInjected = useMemo(() => {
        if (mobileWalletAdapter == null || adapters.indexOf(mobileWalletAdapter) !== -1) {
            return adapters;
        }
        return [mobileWalletAdapter, ...adapters];
    }, [adapters, mobileWalletAdapter]);
    const [walletName, setWalletName] = useLocalStorage<WalletName | null>(
        localStorageKey,
        getIsMobile(adapters) ? SolanaMobileWalletAdapterWalletName : null
    );
    const adapter = useMemo(
        () => adaptersWithDefaultsInjected.find((a) => a.name === walletName) ?? null,
        [adaptersWithDefaultsInjected, walletName]
    );
    useEffect(() => {
        if (adapter == null) {
            return;
        }
        function handleDisconnect() {
            if (isUnloading.current) {
                return;
            }
            if (walletName === SolanaMobileWalletAdapterWalletName && getIsMobile(adapters)) {
                // Leave the adapter selected in the event of a disconnection.
                return;
            }
            setWalletName(null);
        }
        adapter.on('disconnect', handleDisconnect);
        return () => {
            adapter.off('disconnect', handleDisconnect);
        };
    }, [adapter, adapters, setWalletName, walletName]);
    const handleAutoConnectRequest = useMemo(() => {
        if (autoConnect !== true || !adapter) {
            return;
        }
        if (walletName === SolanaMobileWalletAdapterWalletName && getIsMobile(adapters)) {
            return (adapter as SolanaMobileWalletAdapter).autoConnect_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.bind(adapter);
        } else {
            return adapter.connect.bind(adapter);
        }
    }, [adapter, adapters, autoConnect, walletName]);
    useEffect(() => {
        if (adapter == null) {
            return;
        }
        return () => {
            if (
                // Selecting a wallet other than the mobile wallet adapter is not
                // sufficient reason to call `disconnect` on the mobile wallet adapter.
                // Calling `disconnect` on the mobile wallet adapter causes the entire
                // authorization store to be wiped.
                adapter.name !== SolanaMobileWalletAdapterWalletName
            ) {
                adapter.disconnect();
            }
        };
    }, [adapter]);
    const isUnloading = useRef(false);
    useEffect(() => {
        if (walletName === SolanaMobileWalletAdapterWalletName && getIsMobile(adapters)) {
            isUnloading.current = false;
            return;
        }
        function handleBeforeUnload() {
            isUnloading.current = true;
        }
        /**
         * Some wallets fire disconnection events when the window unloads. Since there's no way to
         * distinguish between a disconnection event received because a user initiated it, and one
         * that was received because they've closed the window, we have to track window unload
         * events themselves. Downstream components use this information to decide whether to act
         * upon or drop wallet events and errors.
         */
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [adapters, walletName]);
    return (
        <WalletProviderBase
            {...props}
            adapter={adapter}
            isUnloadingRef={isUnloading}
            key={adapter?.name}
            onAutoConnectRequest={handleAutoConnectRequest}
            onSelectWallet={setWalletName}
            wallets={adaptersWithDefaultsInjected}
        />
    );
}
