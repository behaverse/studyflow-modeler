import PropTypes from 'prop-types';

export function PropertiesGroup(props) {
    const { children } = props;

    return (
        <div className="bg-stone-50 basis-1/5 overflow-y-auto h-[calc(100vh-4rem)] overscroll-contain">
            <div className="p-4">
                <h2 className="text-lg font-semibold text-stone-300">Properties</h2>
                <div className="mt-4">
                    <div className="space-y-4">
                        {children}
                    </div>
                </div>
            </div>
        </div>
    );
}

PropertiesGroup.propTypes = {
    children: PropTypes.node.isRequired
}
