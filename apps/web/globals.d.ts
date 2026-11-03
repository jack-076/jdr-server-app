interface Window {
    CharacterView: { close(): void; updated(): void; openFor(profileId: string): Promise<void>; updatePortrait(): void };
    TokenView: { refresh(): Promise<void>; clear(): void; updatePermissions(): void; profileImage(profileId: string): string | null };
    MapView: { refresh(retry?: number): Promise<void>; clear(): void; currentId(): string | null };
    BoardCamera: { getZoom(): number };
}
