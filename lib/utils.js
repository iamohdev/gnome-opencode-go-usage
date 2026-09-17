// Small formatting helpers. Pure (no GI imports) for easy testing.

const MINUTE = 60_000;

export function clampPercent(value) {
    return Math.max(0, Math.min(100, value));
}

export function levelClass(percent) {
    if (percent >= 100)
        return 'exhausted';
    if (percent > 90)
        return 'critical';
    if (percent >= 70)
        return 'warning';
    return 'normal';
}

// "Resets in 3h 42m", "Resets in 4d 8h", "Resets in 28m", "Resets in <1m"
export function formatCountdown(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    if (total < 60)
        return '<1m';
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (days > 0)
        return `${days}d ${hours}h`;
    if (hours > 0)
        return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

// "12 min ago", "1 hour ago", "3 days ago", "just now"
export function formatRelativeTime(ms) {
    const minutes = Math.max(0, Math.round(ms / MINUTE));
    if (minutes < 1)
        return 'just now';
    if (minutes === 1)
        return '1 min ago';
    if (minutes < 60)
        return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours === 1)
        return '1 hour ago';
    if (hours < 24)
        return `${hours} hours ago`;
    const days = Math.round(hours / 24);
    if (days === 1)
        return '1 day ago';
    return `${days} days ago`;
}

// "17:14"
export function formatClock(date) {
    return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}