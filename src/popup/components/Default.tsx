import logo from '../logo.svg';
import { GenericMessagePage } from './GenericMessagePage';

export function Default() {
    return (
        <GenericMessagePage
            icon={
                <img
                    src={logo}
                    alt="Discord Time Machine Logo"
                    width={100}
                    height={100}
                />
            }
        >
            <p>
                Welcome! To start, go to a Discord tab (or supported sites like
                YouTube) and open this extension again.
            </p>
        </GenericMessagePage>
    );
}
