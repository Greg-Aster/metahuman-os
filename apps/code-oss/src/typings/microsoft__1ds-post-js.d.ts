/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module '@microsoft/1ds-post-js' {
	export interface IPayloadData {
		[key: string]: any;
	}

	export interface IXHROverride {
		sendPOST?: (payload: IPayloadData, oncomplete: (status: number, headers: { [key: string]: string }) => void) => void;
	}

	export interface IChannelConfiguration {
		eventsLimitInMem?: number;
		autoFlushEventsLimit?: number;
		httpXHROverride?: IXHROverride;
		[key: string]: any;
	}

	export interface IChannelControls {
		pause(): void;
		resume(): void;
		teardown(): void;
		flush(): void;
		identifier: string;
		priority?: number;
		processTelemetry?: (event: any) => void;
		initialize?: (config: any) => void;
		[key: string]: any;
	}

	export class AppInsightsCore {
		initialize(config: any, extensions: any[]): void;
		track(event: any): void;
	}

	export class PostChannel implements IChannelControls {
		readonly identifier: string;
		priority: number;
		processTelemetry: (event: any) => void;
		initialize: (config: any) => void;
		constructor();
		pause(): void;
		resume(): void;
		teardown(): void;
		flush(): void;
	}

	export const PropertiesPluginIdentifier: string;
	export const EventPersistence: any;
	export const EventSendType: any;
}
