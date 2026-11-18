import { FaRegMeh } from 'react-icons/fa';
import { GenericMessagePage } from './GenericMessagePage';

export function ErrorPage() {
    return (
        <GenericMessagePage icon={FaRegMeh}>
            <p>Something went wrong. Please refresh the page.</p>
        </GenericMessagePage>
    );
}
